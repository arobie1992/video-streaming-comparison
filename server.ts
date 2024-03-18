import ffmpeg from 'npm:fluent-ffmpeg';
ffmpeg.setFfmpegPath('/Users/Andrew/node_modules/@ffmpeg-installer/darwin-x64/ffmpeg');

const port= 8080;

const handler = (request: Request): Promise<Response>|Response => {
    const url = new URL(request.url);
    if(url.pathname.startsWith("/stream")) {
        return videoHandler(request);
    }
    return pageHandler();
};

const pageHandler = async (): Promise<Response> => {
    const file = await Deno.readFile("./client/ws-stored.html");
    return new Response(file, {
        headers: {"content-type": "text/html"},
        status: 200
    });
}

const videoHandler = (request: Request): Response => {
    const upgrade = request.headers.get("upgrade") || "";
    if (upgrade.toLowerCase() != "websocket") {
        return new Response("request isn't trying to upgrade to websocket.");
    }

    const { socket, response } = Deno.upgradeWebSocket(request);
    socket.onopen = async () => {
        console.log("beginning sending video");
        // ffmpegStream(socket);
        await fileStream(socket);
    }
    socket.onclose = () => console.log('closed with remaining:', socket.bufferedAmount);
    return response;
}

const ffmpegStream = (socket: WebSocket) => {
    let finished = false;

    let i = 0;
    const start = performance.now();
    const command = ffmpeg("./video/fragged-SampleVideo_1280x720_30mb.mp4")
        // finally! https://stackoverflow.com/questions/49429954/mfcreatefmpeg4mediasink-does-not-generate-mse-compatible-mp4
        .outputOptions(['-movflags frag_keyframe+empty_moov+default_base_moof'])
        .format('mp4')
        .audioCodec('copy')
        .videoCodec('copy')
        .on('error', (err: string) => console.log('An error occurred: ' + err))
        .on('end', () => {
            finished = true;
        });

    const q: any[] = [];
    const ffstream = command.pipe();
    ffstream.on('data', (chunk: any) => {
        i += chunk.length;
        q.push(chunk);
    });

    const throttle = () => {
        if(finished && !q.length) {
            socket.close(1000, "stream finished");
            console.log('Processing finished:', i, "bytes", performance.now() - start, "ms");
            return;
        }
        const chunk = q.shift();
        if(chunk) {
            socket.send(chunk);
        }
        setTimeout(throttle, 10);
    }
    throttle();
}

const fileStream = async (socket: WebSocket) => {
    const f = Deno.openSync("./video/fragged-SampleVideo_1280x720_30mb.mp4");
    const send = (buff: Uint8Array) => socket.send(buff);
    const cleanup = () => socket.close(1000, "stream finished")
    await throttledSend(send, cleanup, f.readable.getReader(), 0);
}

const throttledSend = async (send: (buff: Uint8Array) => void , cleanup: () => void, f: ReadableStreamDefaultReader<Uint8Array>, totalSent: number) => {
    const body = await f.read();
    if(body.done) {
        cleanup();
        return;
    }
    const data = body.value;
    send(data);
    totalSent += data.length;
    // console.log(totalSent);
    setTimeout(() => throttledSend(send, cleanup, f, totalSent), 1);
}

Deno.serve({ port }, handler);
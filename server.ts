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
        const f = Deno.openSync("./video/fragged-SampleVideo_1280x720_30mb.mp4");
        const send = (buff: Uint8Array) => socket.send(buff);
        const cleanup = () => socket.close(1000, "stream finished")
        await throttledSend(send, cleanup, f.readable.getReader(), 0);
    }
    socket.onclose = () => console.log('closed with remaining:', socket.bufferedAmount);
    return response;
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
import { Eta } from "https://deno.land/x/eta@v3.0.3/src/index.ts";
const eta = new Eta({ views: 'client/', cache: true });

const loadConfig = () => {
    const configContents = Deno.readTextFileSync("./config.json");
    return JSON.parse(configContents);
}

const config = loadConfig();

const handler = (request: Request): Promise<Response>|Response => {
    const url = new URL(request.url);
    if(url.pathname.startsWith("/stream")) {
        return videoHandler(request);
    }
    return pageHandler();
};

const pageHandler = async (): Promise<Response> => {
    const file = eta.render('ws-stored', {
        transport: 'WebSocket',
        videoType: 'Stored',
        host: `${config.hostname}:${config.port}`
    });
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
        await fileStream(socket);
    }
    socket.onclose = () => console.log('closed with remaining:', socket.bufferedAmount);
    return response;
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
    setTimeout(() => throttledSend(send, cleanup, f, totalSent), 1);
}

Deno.serve({ hostname: config.hostname, port: config.port }, handler);
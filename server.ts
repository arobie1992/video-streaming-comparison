const port= 8080;

const handler = (request: Request): Promise<Response>|Response => {
    const url = new URL(request.url);
    if(url.pathname.startsWith("/video")) {
        // return videoHandler(request);
        return vh();
    }
    return pageHandler();
};

const vh = (): Response => {
    console.log("whole thing");
    const vid = Deno.readFileSync("./video/fragged-SampleVideo_1280x720_30mb.mp4");
    return new Response(vid, {
        status: 200,
        headers: {
            "content-type": "video/mp4"
        }
    });
}

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
    socket.onopen = () => {
        console.log("ready state:", socket.readyState);
        streamVideo(buff => socket.send(buff), () => socket.close());
    }
    return response;
}

const streamVideo = (send: (buff: Uint8Array) => void, cleanup: () => void) => {
    // return () => {
        console.log("beginning sending video");
        const len = 1500;
        const buff = new Uint8Array(len);
        const f = Deno.openSync("./video/SampleVideo_1280x720_30mb.mp4");
        let totalSent = 0;
        for(let out = f.readSync(buff); out === len; out = f.readSync(buff)) {
            send(buff);
            totalSent += out;
        }
        console.log("Total sent: ", totalSent);
        cleanup();
    // }
}

console.log(`HTTP server running. Access it at: http://localhost:8080/`);
Deno.serve({ port }, handler);
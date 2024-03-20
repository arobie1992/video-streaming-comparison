import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { Eta, EtaFileResolutionError } from "eta";
import { WebSocketServer } from 'ws';
import * as fs from 'node:fs';
import { Http3Server } from "@fails-components/webtransport";

const loadConfig = async () => {
    const configContents = await readFile("config.json");
    return JSON.parse(configContents);
}

const config = await loadConfig();
const key = await readFile(".scratch/key.pem");
const cert = await readFile(".scratch/cert.pem");
const eta = new Eta({ views: "client", cache: false });

const httpsServer = createServer(
    {key, cert},
    async (req, res) => {
        const parts = req.url.substring(1).split('/');
        try {
            const page = eta.render(`${parts[0]}-${parts[1]}`, {
                transport: parts[0],
                videoType: parts[1],
                host: `${config.hostname}:${config.port}`
            });
            res.writeHead(200, {"content-type": "text/html"});
            res.write(page);
        } catch(e) {
            if(e instanceof EtaFileResolutionError) {
                res.writeHead(404, {"content-type": "text/html"});
                res.write(eta.render('not-found'));
            } else {
                console.log(e);
                res.writeHead(500, {"content-type": "text/html"});
                res.write(eta.render('server-error'));
            }
        } finally {
            res.end();
        }
    }
);

const streamVideo = (send, close) => {
    console.log("beginning sending video");
    const readStream = fs.createReadStream("video/fragged-SampleVideo_1280x720_30mb.mp4");
    let bytesSent = 0;
    readStream.on('data', function(chunk) {
        bytesSent += chunk.length;
        send(chunk);
    });

    readStream.on('end', function() {
        console.log("finished sending video", bytesSent);
        close();
    });
}

const wss = new WebSocketServer({ noServer: true });
wss.on('connection', async function connection(ws) {
    ws.on('error', console.error);
    streamVideo((chunk) => ws.send(chunk), () => ws.close());
});

httpsServer.on('upgrade', function upgrade(request, socket, head) {
    if (request.url === '/stream') {
        wss.handleUpgrade(request, socket, head, function done(ws) {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

httpsServer.listen(config.port, config.hostname, () => {
    console.log(`server listening at https://${config.hostname}:${config.port}`);
});

const h3Server = new Http3Server({
    port: config.port,
    host: config.host ?? 'localhost',
    secret: "test_secret",
    cert: cert,
    privKey: key
});
h3Server.startServer();

(async () => {
    const stream = await h3Server.sessionStream("/wtstream");
    const sessionReader = stream.getReader();

    // this is the event loop to handle incoming streams from the client
    while (true) {
        const { done, value: session } = await sessionReader.read();
        if (done) {
            break;
        }
        const streamsReader = await session.incomingBidirectionalStreams.getReader();
        while(true) {
            const { done, value: stream } = await streamsReader.read();
            if(done) {
                break;
            }
            const writer = await stream.writable.getWriter();
            streamVideo((chunk) => writer.write(chunk), () => writer.close());
        }
    }
})();
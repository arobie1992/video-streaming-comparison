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
        if(req.url === '/ws/call') {
            const file = fs.readFileSync("client/ws-call.html");
            res.writeHead(200, {"content-type": "text/html"});
            res.write(file);
            res.end();
            return;
        }
        if(req.url === '/wt/call') {
            const file = fs.readFileSync("client/wt-call.html");
            res.writeHead(200, {"content-type": "text/html"});
            res.write(file);
            res.end();
            return;
        }
        if(req.url === "/video/raw") {
            const file = fs.readFileSync("video/fragged-SampleVideo_1280x720_30mb.mp4");
            res.writeHead(200, {"content-type": "video/mp4"});
            res.write(file);
            res.end();
            return;
        }
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
wss.on('connection', async function connection(ws, req) {
    ws.on('error', console.error);
    if(req.url === '/stream/call') {
        let i = 0;
        let remoteFinished = false;
        let localFinished = false;
        ws.on('message', (chunk) => {
            i += chunk.length;
            if(chunk.length === 0) {
                console.log('remote finished');
                remoteFinished = true;
            }
            if(localFinished && remoteFinished) {
                console.log('both local and remote finished, closing');
                ws.close();
            }
        });
        ws.onclose = () => console.log('received', i);
        streamVideo((chunk) => ws.send(chunk), () => {
            ws.send(new Uint8Array());
            localFinished = true;
            console.log('local finished');
            if(localFinished && remoteFinished) {
                console.log('both local and remote finished, closing');
                ws.close();
            }
        });
    } else {
        streamVideo((chunk) => ws.send(chunk), () => ws.close());
    }
});

httpsServer.on('upgrade', function upgrade(request, socket, head) {
    if (request.url.startsWith('/stream')) {
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

const wtEventLoop = async (streamPath, wtBehavior) => {
    const stream = await h3Server.sessionStream(streamPath);
    const sessionReader = stream.getReader();

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
            wtBehavior(stream);
        }
    }
}

wtEventLoop('/wtstream', async (stream) => {
    const writer = await stream.writable.getWriter();
    streamVideo((chunk) => writer.write(chunk), () => writer.close());
});

wtEventLoop('/wtstream/call', async (stream) => {
    const writer = await stream.writable.getWriter();
    streamVideo((chunk) => writer.write(chunk), () => {
        console.log('local finished sending');
        writer.close();
    });
    (async () => {
        const reader = await stream.readable.getReader();
        let i = 0;
        while(true) {
            const { done, value } = await reader.read();
            if(done || value.length === 0) {
                break;
            }
            i += value.length;
        }
        console.log('finished receiving', i);
    })();
});
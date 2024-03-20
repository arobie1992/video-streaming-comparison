import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { Eta } from "eta";
import { WebSocketServer } from 'ws';
import * as fs from 'node:fs';

const loadConfig = async () => {
    const configContents = await readFile("config.json");
    return JSON.parse(configContents);
}

const config = await loadConfig();
const key = await readFile(".scratch/key.pem");
const cert = await readFile(".scratch/cert.pem");
const eta = new Eta({ views: "client", cache: true });

const httpsServer = createServer(
    {key, cert},
    async (req, res) => {
        const page = eta.render('ws-stored', {
            transport: 'WebSocket',
            videoType: 'Stored',
            host: `${config.hostname}:${config.port}`
        });
        res.writeHead(200, {"content-type": "text/html"});
        res.write(page);
        res.end();
    }
);

const wss = new WebSocketServer({ noServer: true });
wss.on('connection', async function connection(ws) {
    ws.on('error', console.error);
    console.log("beginning sending video");

    const readStream = fs.createReadStream("video/fragged-SampleVideo_1280x720_30mb.mp4");
    let i = 0;
    readStream.on('data', function(chunk) {
        i += chunk.length;
        ws.send(chunk);
    });

    readStream.on('end', function() {
        console.log("finished sending video", i);
        ws.close();
    });
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
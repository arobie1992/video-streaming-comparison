import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { WebSocketServer } from 'ws';
import * as fs from 'node:fs';
import { Http3Server } from "@fails-components/webtransport";
import * as ejs from 'ejs';

const textEncoder = new TextEncoder();

const metricReports = {};

const loadConfig = async () => {
    const configContents = await readFile("config.json");
    return JSON.parse(configContents);
}

const config = await loadConfig();
const key = await readFile(".scratch/key.pem");
const cert = await readFile(".scratch/cert.pem");

const standardDeviation = (values) => {
    const n = values.length;
    const mean = values.reduce((a, b) => a + b) / n;
    return Math.sqrt(values.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n);
}

const calculateMetrics = () => {
    const reports = [];
    Object.keys(metricReports).forEach((key) => {
        const metrics = metricReports[key];
        const report = {
            streamId: key,
            scenario: metrics.clientReport.scenario,
            throughput: {
                value: undefined,
                unit: "bytes/ms"
            },
            jitter: {
                average: undefined,
                stdev: undefined,
                unit: "ms"
            },
            latency: {
                average: undefined,
                stdev: undefined,
                unit: "ms"
            },
            errorRate: {
                value: undefined,
                unit: "%"
            },
            startDelay: {
                value: undefined,
                unit: "ms"
            },
            rebufferingRatio: {
                value: undefined,
                unit: "%"
            }
        };
        // throughput calculation
        const times = metrics.clientReport.metrics.snapshots.map(s => s.time);
        const duration = times[times.length-1] - times[0];
        const totalBytes = metrics.clientReport.metrics.snapshots.map(s => s.msgLength).reduce((acc, v) => acc + v, 0);
        report.throughput.value = totalBytes/Math.max(duration, 1);

        // jitter calculation
        const interarrivalTimes = [];
        for(let i = 1; i < times.length-1; i++) {
            interarrivalTimes.push(times[i] - times[i-1]);
        }
        report.jitter.average = interarrivalTimes.reduce((acc, v) => acc + v, 0)/interarrivalTimes.length;
        report.jitter.stdev = standardDeviation(interarrivalTimes);
        reports.push(report);
    });
    return reports;
}

const httpsServer = createServer(
    {key, cert},
    async (req, res) => {
        if(req.url === '/timestamp') {
            req.on('data', chunk => {
                const body = JSON.parse(chunk.toString());
                body.serverTime = performance.now();
                res.writeHead(200, {"content-type": "application/json"});
                res.write(JSON.stringify(body));
                res.end();
            });
            return;
        }
        if(req.url === "/video/raw") {
            const file = fs.readFileSync("video/fragged-SampleVideo_1280x720_30mb.mp4");
            res.writeHead(200, {"content-type": "video/mp4"});
            res.write(file);
            res.end();
            return;
        }
        if(req.url === '/metrics') {
            switch (req.method) {
                case "POST":
                    let buff = "";
                    const contentLength = +req.headers["content-length"];
                    req.on('data', chunk => {
                        buff += chunk.toString();
                        if(buff.length === contentLength) {
                            const report = JSON.parse(buff);
                            if(!metricReports[report.metrics.streamId]) {
                                metricReports[report.metrics.streamId] = {};
                            }
                            metricReports[report.metrics.streamId].clientReport = report;
                            res.writeHead(200);
                            res.end();
                        }
                    });
                    break;
                case "GET":
                    const body = JSON.stringify(calculateMetrics());
                    res.writeHead(200, {'content-type': 'application/json'});
                    res.write(body);
                    res.end();
                    break;
                default:
                    res.writeHead(405, {'Allow': ["GET", "POST"].join(',')});
                    res.end();
            }
            return;
        }
        const parts = req.url.substring(1).split('/');
        try {
            const page = await ejs.renderFile(`client/${parts[0]}-${parts[1]}.ejs`, {
                host: `${config.hostname}:${config.port}`
            });
            res.writeHead(200, {"content-type": "text/html"});
            res.write(page);
        } catch(e) {
            if(e.message.startsWith('ENOENT: no such file or directory, open ')) {
                res.writeHead(404, {"content-type": "text/html"});
                res.write(await ejs.renderFile('client/not-found.ejs'));
            } else {
                console.log(e);
                res.writeHead(500, {"content-type": "text/html"});
                res.write(ejs.renderFile('client/server-error.ejs'));
            }
        } finally {
            res.end();
        }
    }
);

const addSnapshot = (metrics, seqNo, message, type) => {
    metrics.snapshots.push({
        time: performance.now(),
        seqNo,
        message,
        type
    });
}

const processMetrics = async (metrics) => {
    const processedMetrics = [];
    for(const m of metrics.snapshots) {
        const msgLength = m.message ? m.message.length : 0;
        const msgHash = m.message ? await crypto.subtle.digest("SHA-1", m.message) : null;
        const msgHashStr = msgHash
            ? Array.from(new Uint8Array(msgHash)).map((b) => b.toString(16).padStart(2, "0")).join("")
            : null;
        processedMetrics.push({
            time: m.time,
            seqNo: m.seqNo,
            msgHash: msgHashStr,
            msgLength,
            type: m.type
        })
    }
    metrics.snapshots = processedMetrics;
    return metrics;
}

const streamVideo = (send, close) => {
    const streamId = crypto.randomUUID();
    let seqNoCounter = 0;
    const metrics = {
        streamId,
        snapshots: []
    };
    send(textEncoder.encode(`${seqNoCounter++}.${streamId}`));

    console.log("beginning sending video");
    const readStream = fs.createReadStream("video/fragged-SampleVideo_1280x720_30mb.mp4");
    addSnapshot(metrics, null, 0, 'open');
    let bytesSent = 0;

    readStream.on('data', function(chunk) {
        const seqNo = seqNoCounter++;
        addSnapshot(metrics, seqNo, chunk, 'message send');
        send(chunk);
        bytesSent += chunk.length;
    });

    readStream.on('end', async function() {
        console.log("finished sending video", bytesSent);
        close();
        addSnapshot(metrics, null, 0, 'close');
        if(!metricReports[streamId]) {
            metricReports[streamId] = {};
        }
        metricReports[streamId].serverReport = await processMetrics(metrics);
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
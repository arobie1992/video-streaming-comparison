if(Deno.args.length != 1) {
    console.log("Must provide metrics directory");
    Deno.exit(1);
}

const metricsDirPath = Deno.args[0];
const metricsDir = Deno.readDirSync(metricsDirPath);

const reportRegex = /report\d+\.json/;
const reportFileNames: string[] = [];
for(const entry of metricsDir) {
    if(!entry.isFile || !entry.name.match(reportRegex)) {
        continue;
    }
    const reportFilePath = metricsDirPath.endsWith('/') ? `${metricsDirPath}${entry.name}` : `${metricsDirPath}/${entry.name}`;
    reportFileNames.push(reportFilePath);
}

const reportsByScenario = reportFileNames
    .map(n => Deno.readTextFileSync(n))
    .map(t => JSON.parse(t))
    .flatMap(arr => arr)
    .reduce((acc, r) => {
        if(!r.scenario) {
            return acc;
        }
        if(!acc.has(r.scenario)) {
            acc.set(r.scenario, []);
        }
        acc.get(r.scenario).push(r);
        return  acc;
    }, new Map<string, any[]>());

const reportsByScenarioAndLat = new Map<string, Map<string, any[]>>();
for(const [k, v] of reportsByScenario) {
    const byLat = v.reduce((acc: Map<string, any[]>, r: any) => {
        const lat =  r.tags['lat'].endsWith('ms') || r.tags['lat'] === 'N/A'
            ? r.tags['lat']
            : r.tags['lat'] + 'ms';
        const latAndBw = JSON.stringify({bw: r.tags['bw'], lat});
        if(!acc.has(latAndBw)) {
            acc.set(latAndBw, []);
        }
        acc.get(latAndBw).push(r);
        return acc;
    }, new Map<string, any[]>());
    reportsByScenarioAndLat.set(k, byLat);
}

const average = (values: number[]) => {
    return values.reduce((a, b) => a + b) / values.length;
}

const standardDeviation = (values: number[]) => {
    const n = values.length;
    const mean = average(values);
    return Math.sqrt(values.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n);
}

const byScenarioLatAndPlr = new Map<string, Map<string, Map<string, any[]>>>();
for(const [scenario, byScenario] of reportsByScenarioAndLat) {
    const byLatAndPlr = new Map<string, Map<string, any[]>>();
    for(const [latAndBw, byLat] of byScenario) {
        const byPlr = byLat.reduce((acc, r) => {
            if(!acc.has(r.tags['plr'])) {
                acc.set(r.tags['plr'], []);
            }
            acc.get(r.tags['plr']).push(r);
            return acc;
        }, new Map<string, any[]>());
        const avgByPlr = new Map<string, any>();
        for(const [plr, reports] of byPlr) {
            const throughputs = [];
            const jitterMins = [];
            const jitterMaxes = [];
            const jitterAvgs = [];
            const jitterStdevs = [];
            const startDelays = [];
            const rebufRatios = [];
            let clientFailedCount = 0;
            for(const report of reports) {
                if(report.meta && report.meta.includes('client failed')) {
                    clientFailedCount++;
                    continue;
                }
                throughputs.push(report.throughput.value);
                jitterMins.push(report.jitter.min);
                jitterMaxes.push(report.jitter.max);
                jitterAvgs.push(report.jitter.average);
                jitterStdevs.push(report.jitter.stdev);
                startDelays.push(report.startDelay.value);
                rebufRatios.push(report.rebufferingRatio.value);
            }

            const avgs = {
                numClientFailures: clientFailedCount,
                throughput: {
                    average: average(throughputs),
                    stdev: standardDeviation(throughputs),
                    unit: "bytes/ms"
                },
                jitter: {
                    min: {
                        average: average(jitterMins),
                        stdev: standardDeviation(jitterMins),
                    },
                    max: {
                        average: average(jitterMaxes),
                        stdev: standardDeviation(jitterMaxes),
                    },
                    average: {
                        average: average(jitterAvgs),
                        stdev: standardDeviation(jitterAvgs),
                    },
                    stdev: {
                        average: average(jitterStdevs),
                        stdev: standardDeviation(jitterStdevs),
                    },
                    unit: "ms"
                },
                startDelay: {
                    average: average(startDelays),
                    stdev: standardDeviation(startDelays),
                    unit: "ms"
                },
                rebufferingRatio: {
                    average: average(rebufRatios),
                    stdev: standardDeviation(rebufRatios),
                    unit: "%"
                }
            }
            avgByPlr.set(plr, avgs);
        }
        byLatAndPlr.set(latAndBw, avgByPlr);
    }
    byScenarioLatAndPlr.set(scenario, byLatAndPlr);
}

// time to flatten things (sort of) so the json is valid
const flattened = [];
for(const [scenario, byScenario] of byScenarioLatAndPlr) {
    const flattenedLat: any[] = [];
    for(const [latAndBw, byLat] of byScenario) {
        const flattenedPlr: any[] = [];
        for(const [plr, byPlr] of byLat) {
            flattenedPlr.push({
                plr,
                value: byPlr
            });
        }
        const parsed = JSON.parse(latAndBw);
        flattenedLat.push({
            lat: parsed.lat,
            bw: parsed.bw,
            entries: flattenedPlr.sort((a, b) => a.plr.localeCompare(b.plr))
        });
    }
    flattened.push({
        scenario,
        entries: flattenedLat
    });
}

const outFileJson = metricsDirPath.endsWith('/') ? `${metricsDirPath}output.json` : `${metricsDirPath}/output.json`;
const jsonContent = JSON.stringify(flattened, null, 2);
Deno.writeTextFileSync(outFileJson, jsonContent);

const outFileCsv = metricsDirPath.endsWith('/') ? `${metricsDirPath}output.csv` : `${metricsDirPath}/output.csv`;
let csvContent = 'scenario,bw,lat,plr,numClientFailures,throughput avg,throughput stdev,jitter min avg, jitter min stdev,jitter max avg,jitter max stdev,jitter avg avg,jitter avg stdev,jitter stdev avg,jitter stdev stdev,start delay avg,start delay stdev,rebuffering ratio avg,rebuffering ratio stdev\n';
for(const byScen of flattened) {
    for(const byLat of byScen.entries) {
        for(const byPlr of byLat.entries) {
            const metrics = byPlr.value;
            csvContent += `${byScen.scenario},${byLat.bw},${byLat.lat},${byPlr.plr},${metrics.numClientFailures},${metrics.throughput.average},${metrics.throughput.stdev},${metrics.jitter.min.average},${metrics.jitter.min.stdev},${metrics.jitter.max.average},${metrics.jitter.max.stdev},${metrics.jitter.average.average},${metrics.jitter.average.stdev},${metrics.jitter.stdev.average},${metrics.jitter.stdev.stdev},${metrics.startDelay.average},${metrics.startDelay.stdev},${metrics.rebufferingRatio.average},${metrics.rebufferingRatio.stdev}\n`;
        }
    }
}
Deno.writeTextFileSync(outFileCsv, csvContent);
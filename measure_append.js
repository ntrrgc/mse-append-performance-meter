const params = new URLSearchParams(location.search);

const hasVideo = params.has("video");
const hasAudio = params.has("audio");
const logEnabled = !params.has("no_log");
const restMillis = params.has("rest") ? parseInt(params.get("rest")) : 100;
const maxIterations = params.has("max_iter") ? parseInt(params.get("max_iter")) : 30;
const primingIters = params.has("priming") ? parseInt(params.get("priming")) : 3;
const testTag = params.get("tag");
if (!hasAudio && !hasVideo) {
    params.append("video", "");
    params.append("audio", "");
    location.href = `?${params}`;
}

// The ?tag parameter allows to add a line at the top of the page with custom
// text. This is useful to preserve context when you make a screenshots.
if (testTag) {
    lblTag.innerText = testTag;
}

/** @type {HTMLMediaElement} */
const mediaElement = document.getElementById("mediaElement");
const mediaSource = new MediaSource();
/** @type {Uint8Array<ArrayBuffer>} */
let videoData;
/** @type {Uint8Array<ArrayBuffer>} */
let audioData;
/** @type {SourceBuffer} */
let sbVideo;
/** @type {SourceBuffer} */
let sbAudio;

function onceEventPromise(obj, evName) {
    return new Promise((resolve) => {
        obj.addEventListener(evName, () => {
            resolve();
        }, {once: true});
    });
}

const resultElement = document.getElementById("result");

function log(msg) {
    if (!logEnabled)
        return;
    console.log(msg);
}

async function fetchBytes(url) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url)
        xhr.responseType = "arraybuffer";
        xhr.addEventListener("load", () => {
            resolve(new Uint8Array(xhr.response));
        });
        xhr.addEventListener("error", reject);
        xhr.send(null);
    });
}
async function sbAppend(sb, bytes) {
    const updateend = onceEventPromise(sb, "updateend");
    sb.appendBuffer(bytes);
    await updateend;
}
function waitMillis(t) {
    return new Promise(resolve => {
        setTimeout(() => resolve(), t);
    });
}

function formatMillis(t) {
    return `${t.toFixed(1)} ms`;
}

/** @type {{[timer: string]: number[]}} */
const completionTimesByTimer = {
    "updateend-video": [],
    "updateend-audio": [],
    "post-update": [],
    "canplaythrough": [],
};
if (!hasAudio) {
    delete completionTimesByTimer["updateend-audio"];
    document.getElementById("row-updateend-audio").remove();
}
if (!hasVideo) {
    delete completionTimesByTimer["updateend-video"];
    document.getElementById("row-updateend-video").remove();
}

function calcVariance(values, avg) {
    let totalSquareDeviation = 0;
    for (let val of values) {
        totalSquareDeviation += Math.pow(val - avg, 2);
    }
    return totalSquareDeviation / values.length;
}

function tableFillData(td, dataValue, humanValue) {
    td.setAttribute("data-value", JSON.stringify(dataValue));
    td.innerText = humanValue;
}
function tableFillInteger(td, val) {
    tableFillData(td, val, val);
}
function tableFillPercentage(td, ratio) {
    tableFillData(td, ratio, `${(100 * ratio).toFixed(1)}%`);
}
function tableFillMillis(td, millis) {
    tableFillData(td, millis, formatMillis(millis));
}

function updateTables() {
    for (let [timerKey, completionTimes] of Object.entries(completionTimesByTimer)) {
        let total = 0;
        let min = Infinity;
        let max = -Infinity;
        let countGreater500ms = 0;
        for (let t of completionTimes) {
            if (t > 500)
                countGreater500ms++;
            if (t < min)
                min = t;
            if (t > max)
                max = t;
            total += t;
        }
        const avg = total / completionTimes.length;
        const stdDev = Math.sqrt(calcVariance(completionTimes, avg));
        const cv = stdDev / avg;

        const tr = document.getElementById(`row-${timerKey}`);
        let i = 1;
        tableFillMillis(tr.children[i++], min);
        tableFillMillis(tr.children[i++], avg);
        tableFillMillis(tr.children[i++], max);
        tableFillMillis(tr.children[i++], stdDev);
        tableFillPercentage(tr.children[i++], cv);
        tableFillMillis(tr.children[i++], total);
        tableFillInteger(tr.children[i++], countGreater500ms);
    }
}

async function runTest() {
    const mediaSourceOpened = onceEventPromise(mediaSource, "sourceopen");
    mediaElement.src = URL.createObjectURL(mediaSource);
    await mediaSourceOpened;

    canplaythrough = onceEventPromise(mediaElement, "canplaythrough");
    let updateEndCallbacksRemaining = 0;
    let tAllUpdateEnds = Infinity;
    function checkRemainingUpdateEnds() {
        updateEndCallbacksRemaining--;
        if (updateEndCallbacksRemaining < 0) throw new Error("more updateend's than expected");
        if (updateEndCallbacksRemaining == 0)
            tAllUpdateEnds = performance.now();
    }

    if (hasAudio) {
        sbAudio = mediaSource.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
        updateEndCallbacksRemaining++;
    }
    if (hasVideo) {
        sbVideo = mediaSource.addSourceBuffer('video/mp4; codecs="avc1.640033"');
        updateEndCallbacksRemaining++;
    }

    const t0 = performance.now();
    let tUpdateAudio = Infinity;
    let tUpdateVideo = Infinity;
    if (hasAudio) {
        sbAppend(sbAudio, audioData).then(() => {
            tUpdateAudio = performance.now()
        }).then(checkRemainingUpdateEnds);
    }
    if (hasVideo) {
        sbAppend(sbVideo, videoData).then(() => {
            tUpdateVideo = performance.now()
        }).then(checkRemainingUpdateEnds);
    }
    await canplaythrough;
    const tCanPlayThrough = performance.now();
    const deltaPostUpdate = tCanPlayThrough - tAllUpdateEnds;

    if (hasAudio) {
        // log(`sbAudio updateend took ${formatMillis(tUpdateAudio - t0)}`);
        completionTimesByTimer["updateend-audio"].push(tUpdateAudio - t0);
    }
    if (hasVideo) {
        // log(`sbVideo updateend took ${formatMillis(tUpdateVideo - t0)}`);
        completionTimesByTimer["updateend-video"].push(tUpdateVideo - t0);
    }
    // log(`post-update took ${formatMillis(deltaPostUpdate)}`)
    completionTimesByTimer["post-update"].push(deltaPostUpdate);
    // log(`canplaythrough took ${formatMillis(tCanPlayThrough - t0)}`);
    completionTimesByTimer["canplaythrough"].push(tCanPlayThrough - t0);
    updateTables();
}

let testBatteryStartTime = null;
async function main() {
    audioData = await fetchBytes("car-20120827-8c.mp4");
    videoData = await fetchBytes("big-buck-bunny-h264-720p-30fps.mp4");

    log("priming...")
    document.getElementById("priming-iters").innerText = primingIters;
    for (let i = 0; i < primingIters; i++) {
        document.getElementById("iter-completed").innerText = `Priming ${i}/${primingIters}`
        await runTest();
        if (restMillis >= 0)
            await waitMillis(restMillis);
    }
    // Discard all data collected from priming iterations.
    for (const key in completionTimesByTimer)
        completionTimesByTimer[key].length = 0;

    testBatteryStartTime = performance.now();
    document.getElementById("iter-completed").innerText = 0;
    document.getElementById("total-time").innerText = "0 ms";
    document.getElementById("max-iter").innerText = maxIterations;
    document.getElementById("rest").innerText = formatMillis(restMillis);
    log("test start")

    for (let i = 0; i < maxIterations; i++) {
        await runTest();

        document.getElementById("total-time").innerText = formatMillis(performance.now() - testBatteryStartTime);
        document.getElementById("iter-completed").innerText = i + 1;

        if (restMillis >= 0)
            await waitMillis(restMillis);
    }

    const strParams = `Priming: ${primingIters} Iterations: ${maxIterations}. Rest: ${restMillis} ms.`
    let logOutput = "\n"; // leading newline to make output cleaner in cog.
    logOutput += strParams + "\n";
    if (testTag)
        logOutput += `${testTag}\n`;
    // Script-friendly output first; human-friendly output last (and hence
    // closer to the command prompt).
    logOutput += '\n';
    logOutput += `TEST_DONE: ${resultsTableToJson()}\n`;
    logOutput += resultsTableToMarkdown();
    log(logOutput);
}

function padLeft(str, width) { return str.padStart(width); }
function padRight(str, width) { return str.padEnd(width); }
function padCenter(str, width) {
    if (str.length > width)
        return str;
    const rightFill = Math.floor((width - str.length) / 2);
    const leftFill = width - str.length - rightFill;
    return `${"".padStart(leftFill)}${str}${"".padStart(rightFill)}`;
}

function resultsTableToMarkdown() {
    const htmlTable = document.getElementById("tblResults");
    const colsWidth = [15, 9, 9, 9, 9, 5, 10, 8];
    const rows = Array.from(htmlTable.querySelectorAll("tr"))
        .map((tr, rowIx) => {
            return "| " + Array.from(tr.querySelectorAll("td, th"))
                .map((x, colIx) => {
                    const padFn = rowIx == 0 ? padCenter
                                : colIx == 0 ? padRight
                                : padLeft;
                    return padFn(x.innerText.trim(), colsWidth[colIx]);
                })
                .join(" | ") + " |"
        });
    const separatorRow = "| " + colsWidth.map(width => "".padStart(width, "-"))
        .join(" | ") + " |";
    return [rows[0], separatorRow].concat(rows.slice(1)).join("\n");
}

function resultsTableToJson() {
    const htmlTable = document.getElementById("tblResults");
    const colNames = Array.from(htmlTable.querySelectorAll("thead th"))
        .map(x => x.innerText)
        .slice(1);
    return JSON.stringify(Object.fromEntries(
        Array.from(htmlTable.querySelectorAll("tbody tr")).map(tr => {
            const timerName = tr.querySelector("th").innerText;
            const values = Array.from(tr.querySelectorAll("td"))
                .map(x => x.getAttribute("data-value"))
                .map(JSON.parse);
            const props = {};
            for (let i = 0; i < values.length; i++)
                props[colNames[i]] = values[i];
            return [timerName, props];
        })
    ));
}

if (hasVideo || hasAudio) {
    main().catch(err => {
        log(err);
    });
}
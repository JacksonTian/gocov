#!/usr/bin/env node

import path from "path";
import process from "process";
import { readFile, mkdir, copyFile, writeFile, access, constants } from "fs/promises";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const argv =  process.argv.slice(2);
const [ coverageData ] = argv;
const cwd = process.cwd();

let coveragePath;
if (!coverageData) {
    coveragePath = path.join(cwd, 'coverage.txt');
} else {
    coveragePath = path.join(cwd, coverageData);
}

try {
    await access(coveragePath, constants.R_OK);
} catch {
    console.error(`Error:`);
    console.error(`    ${coveragePath} isn't exists.`);
    process.exit(1);
}

const data = await readFile(coveragePath, 'utf8');

const [modeLine, ...lines] = data.trim().split('\n');
const mode = modeLine.substring('mode: '.length).trim();

function toInt(s) {
    return parseInt(s, 10);
}

function watermark(value) {
    if (value < 50) {
        return 'low';
    }

    if (value > 80) {
        return 'high';
    }

    return 'medium';
}

const coverageDir = path.join(cwd, 'coverage');
await mkdir(coverageDir, {
    recursive: true
});
const templateDir = path.join(__dirname, '../templates');
const files = [
    'base.css',
    'block-navigation.js',
    'favicon.png',
    'prettify.css',
    'prettify.js',
    'sort-arrow-sprite.png',
    'sorter.js'
];

for (const filename of files) {
    await copyFile(path.join(templateDir, filename), path.join(coverageDir, filename));
}

class CodeEmitter {
    constructor() {
        this.parts = [];
    }

    emit(code) {
        this.parts.push((code || ''));
    }

    emitln(code) {
        this.parts.push((code || '') + '\n');
    }

    getOutput() {
        return this.parts.join('');
    }
}

const map = lines.map((d) => {
    // github.com/aliyun/aliyun-cli/cli/color.go:108.20,110.2 1 2
    const [file, others] = d.split(':');
    const [range, branch, count] = others.split(' ');
    const [start, end] = range.split(',');
    const [startLine, startColumn] = start.split('.');
    const [endLine, endColumn] = end.split('.');

    return {
        file,
        start: {
            line: toInt(startLine),
            column: toInt(startColumn)
        },
        end: {
            line: toInt(endLine),
            column: toInt(endColumn)
        },
        branch: toInt(branch),  // 分支数
        count: toInt(count)     // 执行次数
    };
}).reduceRight((pre, d) => {
    if (!pre.has(d.file)) {
        pre.set(d.file, []);
    }
    pre.get(d.file).push(d);
    return pre;
}, new Map());

const list = [];

for (const [file, data] of map) {
    const [domain, org, repo, ...filepath] = file.split('/');
    const ce = new CodeEmitter();
    const sourcePath = filepath.join('/');
    const sources = await readFile(path.join(cwd, sourcePath), 'utf8');
    const lines = sources.split('\n');
    data.sort((a, b) => {
        return a.start.line < b.start.line ? -1 : 1;
    });
    const uncoverageLines = data.filter((d) => {
        return d.count === 0;
    }).reduceRight((pre, d) => {
        return pre + (d.end.line - d.start.line);
    }, 0);
    const totalBranches = data.reduceRight((pre, d) => {
        return pre + d.branch;
    }, 0);
    const coveredBranches = data.filter((d) => {
        return d.count > 0;
    }).reduceRight((pre, d) => {
        return pre + d.branch;
    }, 0);

    const prefix = '../'.repeat(filepath.length);

    ce.emit(`<!doctype html>
    <html lang="en">

    <head>
        <title>Code coverage report for ${repo}/${sourcePath}</title>`);
    ce.emit(`<meta charset="utf-8" />
    <link rel="stylesheet" href="${prefix}prettify.css" />
    <link rel="stylesheet" href="${prefix}base.css" />
    <link rel="shortcut icon" type="image/x-icon" href="${prefix}favicon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style type='text/css'>
        .coverage-summary .sorter {
            background-image: url(${prefix}sort-arrow-sprite.png);
        }
    </style>
    </head>

    <body>`);
    ce.emit(`<div class='wrapper'>`);
    ce.emit(`<div class='pad1'>
    <h1><a href="${prefix}index.html">All files</a> / <a href="index.html">${repo}/${filepath.slice(0, -1).join('/')}</a> ${path.basename(sourcePath)}</h1>
    <div class='clearfix'>
        <div class='fl pad1y space-right2'>
            <span class="strong">${(coveredBranches / totalBranches * 100).toFixed(2)}% </span>
            <span class="quiet">Branches</span>
            <span class='fraction'>${coveredBranches}/${totalBranches}</span>
        </div>

        <div class='fl pad1y space-right2'>
            <span class="strong">${((1 - uncoverageLines / lines.length) * 100).toFixed(2)}% </span>
            <span class="quiet">Lines</span>
            <span class='fraction'>${lines.length - uncoverageLines}/${lines.length}</span>
        </div>
    </div>

    <p class="quiet">
        Press <em>n</em> or <em>j</em> to go to the next uncovered block, <em>b</em>, <em>p</em> or <em>k</em> for the previous block.
    </p>
    <template id="filterTemplate">
        <div class="quiet">
            Filter:
            <input oninput="onInput()" type="search" id="fileSearch">
        </div>
    </template>
</div>`);

    ce.emit(`<div class='status-line ${watermark(coveredBranches / totalBranches * 100)}'></div>`);
    ce.emit(`<pre>`);
    ce.emit(`<table class="coverage">`);
    ce.emit(`<tr>`);
    ce.emit(`<td class="line-count quiet">`);

    for (let i = 0; i < lines.length; i++) {
        ce.emitln(`<a name='L${i + 1}'></a><a href='#L${i + 1}'>${i + 1}</a>`);
    }
    ce.emitln(`</td>`);
    ce.emit(`<td class="line-coverage quiet">`);
    for (let i = 0; i < lines.length; i++) {
        const lineNo = i + 1;
        const range = data.find((d) => {
            return d.start.line <= lineNo && d.end.line >= lineNo;
        });
        if (range) {
            if (range.count > 0) {
                ce.emitln(`<span class="cline-any cline-yes">${range.count}x</span>`);
            } else {
                ce.emitln(`<span class="cline-any cline-no">&nbsp;</span>`);
            }
        } else {
            ce.emitln(`<span class="cline-any cline-neutral">&nbsp;</span>`);
        }
    }
    ce.emit(`</td><td class="text"><pre class="prettyprint lang-go">`);
    lines.forEach((line, i) => {
        const lineNo = i + 1;
        const range = data.find((d) => {
            return d.start.line <= lineNo && d.end.line >= lineNo;
        });
        if (range && range.count === 0) {
            ce.emitln(`<span class="cstat-no" title="not covered" >${line}</span>`);
        } else {
            ce.emitln(line);
        }
    });
    ce.emit('</pre>');
    ce.emit(`</td></tr></table></pre>`);
    ce.emit(`<div class='push'></div><!-- for sticky footer -->`);
    ce.emit(`</div><!-- /wrapper -->`);

    ce.emit(`<div class='footer quiet pad2 space-top1 center small'>
Code coverage generated by
<a href="https://istanbul.js.org/" target="_blank" rel="noopener noreferrer">istanbul</a>
at ${new Date().toISOString()}
</div>
    <script src="${prefix}prettify.js"></script>
    <script>
    window.onload = function () {
    prettyPrint();
    };
    </script>
    <script src="${prefix}sorter.js"></script>
    <script src="${prefix}block-navigation.js"></script>
</body>
</html>`);

    const outputPath = path.join(coverageDir, `${repo}/${sourcePath}.html`);
    const outputDir = path.dirname(outputPath);
    await mkdir(outputDir, {
        recursive: true
    });
    await writeFile(outputPath, ce.getOutput());

    list.push({
        file: file,
        branch: {
            covered: coveredBranches,
            total: totalBranches
        },
        line: {
            covered: lines.length - uncoverageLines,
            total: lines.length
        }
    });
}

function groupBy(list, fn) {
    const map = new Map();
    for (const item of list) {
        const key = fn(item);
        if (!map.has(key)) {
            map.set(key, []);
        }
        map.get(key).push(item);
    }
    return map;
}

const grouped = groupBy(list, (d) => {
    const file = d.file;
    const [domain, org, ...filepath] = file.split('/');
    return filepath.slice(0, -1).join('/');
});

let totalBranches = 0;
let totalLines = 0;
let coveredBranches = 0;
let coveredLines = 0;
for (const [dir, list] of grouped) {
    for (const item of list) {
        totalBranches += item.branch.total;
        totalLines += item.line.total;
        coveredBranches += item.branch.covered;
        coveredLines += item.line.covered;
    }
}
// generate index.html
{
    const ce = new CodeEmitter();
    const prefix = '';

    ce.emit(`<!doctype html>
<html lang="en">

<head>
    <title>Code coverage report for All files</title>`);
    ce.emit(`<meta charset="utf-8" />
<link rel="stylesheet" href="${prefix}prettify.css" />
<link rel="stylesheet" href="${prefix}base.css" />
<link rel="shortcut icon" type="image/x-icon" href="${prefix}favicon.png" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style type='text/css'>
    .coverage-summary .sorter {
        background-image: url(${prefix}sort-arrow-sprite.png);
    }
</style>
</head>

<body>`);

    ce.emit(`<body>
<div class='wrapper'>`);

    ce.emit(`<div class='pad1'>
<h1>All files</h1>
<div class='clearfix'>
    <div class='fl pad1y space-right2'>
        <span class="strong">${(coveredBranches / totalBranches * 100).toFixed(2)}% </span>
        <span class="quiet">Branches</span>
        <span class='fraction'>${coveredBranches}/${totalBranches}</span>
    </div>

    <div class='fl pad1y space-right2'>
        <span class="strong">${(coveredLines / totalLines * 100).toFixed(2)}% </span>
        <span class="quiet">Lines</span>
        <span class='fraction'>${coveredLines}/${totalLines}</span>
    </div>
</div>
<p class="quiet">
    Press <em>n</em> or <em>j</em> to go to the next uncovered block, <em>b</em>, <em>p</em> or <em>k</em> for the previous block.
</p>
<template id="filterTemplate">
    <div class="quiet">
        Filter:
        <input oninput="onInput()" type="search" id="fileSearch">
    </div>
</template>
</div>`);

    ce.emit(`<div class='status-line ${watermark((coveredBranches / totalBranches * 100))}'></div>`);
    ce.emit(`<div class="pad1">
<table class="coverage-summary">
<thead>
<tr>
   <th data-col="file" data-fmt="html" data-html="true" class="file">File</th>
   <th data-col="pic" data-type="number" data-fmt="html" data-html="true" class="pic"></th>
   <th data-col="branches" data-type="number" data-fmt="pct" class="pct">Branches</th>
   <th data-col="branches_raw" data-type="number" data-fmt="html" class="abs"></th>
   <th data-col="lines" data-type="number" data-fmt="pct" class="pct">Lines</th>
   <th data-col="lines_raw" data-type="number" data-fmt="html" class="abs"></th>
</tr>
</thead>
<tbody>`);
    for (const [dir, list] of grouped) {
        let totalBranches = 0;
        let totalLines = 0;
        let coveredBranches = 0;
        let coveredLines = 0;
        for (const item of list) {
            totalBranches += item.branch.total;
            totalLines += item.line.total;
            coveredBranches += item.branch.covered;
            coveredLines += item.line.covered;
        }
        const pct = coveredBranches / totalBranches * 100;
        ce.emit(`<tr>
	<td class="file high" data-value="index.js"><a href="${dir}/index.html">${dir}</a></td>
	<td data-value="${pct.toFixed(2)}" class="pic ${watermark(pct)}">
	<div class="chart"><div class="cover-fill cover-full" style="width: ${Math.floor(pct)}%"></div><div class="cover-empty" style="width: ${100 - Math.floor(pct)}%"></div></div>
	</td>
	<td data-value="${pct.toFixed(2)}" class="pct ${watermark(pct)}">${pct.toFixed(2)}%</td>
	<td data-value="${totalBranches}" class="abs ${watermark((coveredLines / totalLines * 100))}">${coveredBranches}/${totalBranches}</td>
	<td data-value="${(coveredLines / totalLines * 100).toFixed(2)}" class="pct ${watermark((coveredLines / totalLines * 100))}">${(coveredLines / totalLines * 100).toFixed(2)}%</td>
	<td data-value="${totalLines}" class="abs ${watermark(coveredLines / totalLines * 100)}">${coveredLines}/${totalLines}</td>
	</tr>`);
    }

    ce.emit(`</tbody>
</table>
</div>`);
    ce.emit(`<div class='push'></div><!-- for sticky footer -->`);
    ce.emit(`</div><!-- /wrapper -->`);

    ce.emit(`<div class='footer quiet pad2 space-top1 center small'>
Code coverage generated by
<a href="https://istanbul.js.org/" target="_blank" rel="noopener noreferrer">istanbul</a>
at ${new Date().toISOString()}
</div>
    <script src="${prefix}prettify.js"></script>
    <script>
    window.onload = function () {
    prettyPrint();
    };
    </script>
    <script src="${prefix}sorter.js"></script>
    <script src="${prefix}block-navigation.js"></script>
</body>
</html>`);

    await writeFile(path.join(coverageDir, 'index.html'), ce.getOutput());
}

for (const [dir, list] of grouped) {
    let totalBranches = 0;
    let totalLines = 0;
    let coveredBranches = 0;
    let coveredLines = 0;

    for (const item of list) {
        totalBranches += item.branch.total;
        totalLines += item.line.total;
        coveredBranches += item.branch.covered;
        coveredLines += item.line.covered;
    }
    const ce = new CodeEmitter();
    const prefix = '../'.repeat(dir.split('/').length);

    ce.emit(`<!doctype html>
<html lang="en">

<head>
    <title>Code coverage report for ${dir}</title>`);
    ce.emit(`<meta charset="utf-8" />
<link rel="stylesheet" href="${prefix}prettify.css" />
<link rel="stylesheet" href="${prefix}base.css" />
<link rel="shortcut icon" type="image/x-icon" href="${prefix}favicon.png" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style type='text/css'>
    .coverage-summary .sorter {
        background-image: url(${prefix}sort-arrow-sprite.png);
    }
</style>
</head>

<body>`);

    ce.emit(`<body>
<div class='wrapper'>`);

    ce.emit(`<div class='pad1'>
    <h1><a href="${prefix}index.html">All files</a> / ${dir}</h1>
<div class='clearfix'>
    <div class='fl pad1y space-right2'>
        <span class="strong">${(coveredBranches / totalBranches * 100).toFixed(2)}% </span>
        <span class="quiet">Branches</span>
        <span class='fraction'>${coveredBranches}/${totalBranches}</span>
    </div>

    <div class='fl pad1y space-right2'>
        <span class="strong">${(coveredLines / totalLines * 100).toFixed(2)}% </span>
        <span class="quiet">Lines</span>
        <span class='fraction'>${coveredLines}/${totalLines}</span>
    </div>
</div>
<p class="quiet">
    Press <em>n</em> or <em>j</em> to go to the next uncovered block, <em>b</em>, <em>p</em> or <em>k</em> for the previous block.
</p>
<template id="filterTemplate">
    <div class="quiet">
        Filter:
        <input oninput="onInput()" type="search" id="fileSearch">
    </div>
</template>
</div>`);

    ce.emit(`<div class='status-line ${watermark((coveredBranches / totalBranches * 100))}'></div>`);
    ce.emit(`<div class="pad1">
<table class="coverage-summary">
<thead>
<tr>
   <th data-col="file" data-fmt="html" data-html="true" class="file">File</th>
   <th data-col="pic" data-type="number" data-fmt="html" data-html="true" class="pic"></th>
   <th data-col="branches" data-type="number" data-fmt="pct" class="pct">Branches</th>
   <th data-col="branches_raw" data-type="number" data-fmt="html" class="abs"></th>
   <th data-col="lines" data-type="number" data-fmt="pct" class="pct">Lines</th>
   <th data-col="lines_raw" data-type="number" data-fmt="html" class="abs"></th>
</tr>
</thead>
<tbody>`);
    for (const item of list) {
        const pct = item.branch.covered / item.branch.total * 100;
        ce.emit(`<tr>
	<td class="file ${watermark(pct)}" data-value="${path.basename(item.file)}"><a href="${path.basename(item.file)}.html">${path.basename(item.file)}</a></td>
	<td data-value="${pct.toFixed(2)}" class="pic ${watermark(pct)}">
	<div class="chart"><div class="cover-fill cover-full" style="width: ${Math.floor(pct)}%"></div><div class="cover-empty" style="width: ${100 - Math.floor(pct)}%"></div></div>
	</td>
	<td data-value="${pct.toFixed(2)}" class="pct ${watermark(pct)}">${pct.toFixed(2)}%</td>
	<td data-value="${item.branch.total}" class="abs ${watermark((item.branch.covered / item.branch.total * 100))}">${item.branch.covered}/${item.branch.total}</td>
	<td data-value="${(item.line.covered / item.line.total * 100).toFixed(2)}" class="pct ${watermark((item.line.covered / item.line.total * 100))}">${(item.line.covered / item.line.total * 100).toFixed(2)}%</td>
	<td data-value="${item.line.total}" class="abs ${watermark(item.line.covered / item.line.total * 100)}">${coveredLines}/${item.line.total}</td>
	</tr>`);
    }

    ce.emit(`</tbody>
</table>
</div>`);
    ce.emit(`<div class='push'></div><!-- for sticky footer -->`);
    ce.emit(`</div><!-- /wrapper -->`);

    ce.emit(`<div class='footer quiet pad2 space-top1 center small'>
Code coverage generated by
<a href="https://istanbul.js.org/" target="_blank" rel="noopener noreferrer">istanbul</a>
at ${new Date().toISOString()}
</div>
    <script src="${prefix}prettify.js"></script>
    <script>
    window.onload = function () {
    prettyPrint();
    };
    </script>
    <script src="${prefix}sorter.js"></script>
    <script src="${prefix}block-navigation.js"></script>
</body>
</html>`);

    await writeFile(path.join(coverageDir, dir, 'index.html'), ce.getOutput());
}

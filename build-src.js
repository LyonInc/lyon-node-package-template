/**
 * @license
 * MIT License
 *
 * Copyright (c) 2020 Lyon Software Technologies, Inc.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
const esbuild = require('esbuild');
const fs = require('fs-extra');
const dotenv = require('dotenv');
const { performance } = require('perf_hooks');
const chokidar = require('chokidar');
const ts = require('typescript');

// Load JSON files
const packageInfo = require('./package.json');
const tsconfig = require('./tsconfig.json');
const config = require('./build.config.json');

function getBenchmark(label, baseTime) {
  const measure = (performance.now() - baseTime).toFixed(2);
  console.log(`${label}: ${measure}ms`);
}

function getPackageName(name) {
  return name
    .toLowerCase()
    .replace(/(^@.*\/)|((^[^a-zA-Z]+)|[^\w.-])|([^a-zA-Z0-9]+$)/g, '');
}

function readEnv(isProduction) {
  try {
    return dotenv.parse(
      isProduction
        ? fs.readFileSync('.env.production')
        : fs.readFileSync('.env.development'),
    );
  } catch (err) {
    try {
      return dotenv.parse(fs.readFileSync('.env'));
    } catch (err) {
      return {};
    }
  }
}

function parseDefinition(isProduction) {
  const env = readEnv(isProduction);
  const container = {};

  Object.keys(env).forEach((key) => {
    container[`process.env.${key}`] = JSON.stringify(env[key]);
  });

  return container;
}

function readDependencies() {
  const {
    dependencies,
    devDependencies,
    peerDependencies,
    optionalDependencies,
  } = packageInfo;

  const external = new Set();

  Object.keys(dependencies || {}).forEach((key) => {
    external.add(key);
  });
  Object.keys(devDependencies || {}).forEach((key) => {
    external.add(key);
  });
  Object.keys(peerDependencies || {}).forEach((key) => {
    external.add(key);
  });
  Object.keys(optionalDependencies || {}).forEach((key) => {
    external.add(key);
  });

  return Array.from(external);
}

function compile(entryPoint) {
  console.log('Compiling source');
  const compileTime = performance.now();

  const baseConfig = {
    ...tsconfig.compilerOptions,
    outDir: config.outDir,
    emitDeclarationOnly: true,
    moduleResolution: 2,
  };
  // Create a Program with an in-memory emit
  const host = ts.createCompilerHost(baseConfig);

  host.writeFile = (fileName, data) => {
    fs.outputFileSync(`./${fileName}`, data);
  };
  
  // Prepare and emit the d.ts files
  const program = ts.createProgram(
    [entryPoint],
    baseConfig,
    host,
  );
  program.emit();
  getBenchmark('Type declarations', compileTime);
}

async function buildDevelopment(entryPoint, external, output) {
  console.log('Generating Development Build');
  const baseTime = performance.now();
  await esbuild.build({
    entryPoints: [
      entryPoint,
    ],
    outfile: `${output}.development.js`,
    bundle: true,
    minify: false,
    sourcemap: true,
    platform: 'node',
    define: {
      ...(config.definitions || {}),
      ...parseDefinition(false),
      '__DEV__': true,
    },
    external,
    target: config.target,
    tsconfig: config.tsconfig,
    jsxFactory: config.jsxFactory,
    jsxFragment: config.jsxFragment,
  });
  getBenchmark('Development Build', baseTime);
}

async function buildProduction(entryPoint, external, output) {
  console.log('Generating Production Build');
  const baseTime = performance.now();
  await esbuild.build({
    entryPoints: [
      entryPoint,
    ],
    outfile: `${output}.production.min.js`,
    bundle: true,
    minify: true,
    sourcemap: true,
    platform: 'node',
    define: {
      ...(config.definitions || {}),
      ...parseDefinition(true),
      '__DEV__': false,
    },
    external,
    target: config.target,
    tsconfig: config.tsconfig,
    jsxFactory: config.jsxFactory,
    jsxFragment: config.jsxFragment,
  });
  getBenchmark('Production Build', baseTime);
}

async function buildESM(entryPoint, external, output) {
  console.log('Generating ESM Build');
  const baseTime = performance.now();
  await esbuild.build({
    entryPoints: [
      entryPoint,
    ],
    outfile: `${output}.esm.js`,
    bundle: true,
    minify: false,
    format: 'esm',
    sourcemap: false,
    define: {
      ...(config.definitions || {}),
      ...parseDefinition(false),
      '__DEV__': 'process',
    },
    external,
    target: config.target,
    tsconfig: config.tsconfig,
    jsxFactory: config.jsxFactory,
    jsxFragment: config.jsxFragment,
  });
  getBenchmark('ESM Build', baseTime);
}

async function buildAll(entryPoint) {
  console.log('Generating build output');
  const baseTime = performance.now();
  const external = readDependencies();
  const output = `${config.outDir}/${getPackageName(packageInfo.name)}`;
  await Promise.all([
    buildDevelopment(entryPoint, external, output),
    buildProduction(entryPoint, external, output),
    buildESM(entryPoint, external, output)
  ]);
  getBenchmark('Total Build', baseTime);
}

async function buildRoot() {
  console.log('Creating root');
  const baseTime = performance.now();
  const baseLine = `module.exports = require('./${config.name}`;
  const contents = `
'use strict'
if (process.env.NODE_ENV === 'production') {
  ${baseLine}.production.min.js')
} else {
  ${baseLine}.development.js')
}
  `;

  await fs.outputFile(`./${config.outDir}/index.js`, contents);
  getBenchmark('Root Build', baseTime);
}

async function build() {
  console.log('Building Project');
  const baseTime = performance.now();
  await fs.remove(`./${config.outDir}`);
  const entryPoint = `${config.srcDir}/${config.srcFile}`;
  compile(entryPoint);
  await Promise.all([
    buildAll(entryPoint),
    buildRoot(),
  ]);
  getBenchmark('Build duration', baseTime);
}

if (process.argv.includes('--watch') || process.argv.includes('-w')) {
  chokidar.watch(config.srcDir).on('all', () => {
    build().catch(
      (err) => {
        console.error(err);
        process.exit(1);
      },
    );
  });  
} else {
  build().catch(
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
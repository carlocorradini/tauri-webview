import { URL, fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import download from 'download';
import prettier from 'prettier';
import fsExtra from 'fs-extra';
import { JSDOM } from 'jsdom';
import _7z from '7zip-min';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

const WEBVIEW_URL = 'https://developer.microsoft.com/it-it/microsoft-edge/webview2';
const OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src-tauri');
const TAURI_CONFIG_FILE = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../src-tauri/tauri.conf.json'
);
const PRETTIER_CONFIG_FILE = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../.prettierrc'
);

type VersionNumber = `${number}.${number}.${number}.${number}`;

type Version = VersionNumber | 'latest';

type Architecture = 'arm64' | 'x64' | 'x86';

function info(data: string): void {
	console.info(`[INFO ]: ${data}`);
}

function error(data: string): void {
	console.error(`[ERROR]: ${data}`);
}

async function webViewData(
	url: string,
	version: Version,
	architecture: Architecture
): Promise<{ url: URL; version: VersionNumber; architecture: Architecture }> {
	const webViewVersionData = 'webviewVersionData';

	const dom = await JSDOM.fromURL(url);
	const script = Array.from(dom.window.document.scripts).find(
		(script) =>
			script.nonce === 'inline_content' && script.innerHTML.startsWith(`var ${webViewVersionData}`)
	);
	if (!script) {
		throw new Error('WebView script not found');
	}

	const webviews:
		| Array<{
				version: VersionNumber;
				data: Array<{ architecture: Architecture; url: string }>;
		  }>
		| undefined = new JSDOM(new dom.window.XMLSerializer().serializeToString(script), {
		runScripts: 'dangerously'
	}).window[webViewVersionData];
	if (!webviews || webviews.length === 0) {
		throw new Error('WebView version data not found');
	}

	const versionNumber =
		version === 'latest'
			? webviews[0].version
			: webviews.find((webview) => webview.version === version)?.version;
	if (!versionNumber) {
		throw new Error(`Unable to determine WebView data for version '${version}'`);
	}

	const downloadURL = webviews
		.find((webview) => webview.version === versionNumber)
		?.data.find((data) => data.architecture === architecture)?.url;
	if (!downloadURL) {
		throw new Error(
			`Unable to determine WebView data for version '${versionNumber}' and architecture '${architecture}'`
		);
	}

	return { url: new URL(downloadURL), version: versionNumber, architecture };
}

function unpack(pathToArchive: string, whereToUnpack: string): Promise<void> {
	return new Promise((resolve, reject) => {
		_7z.unpack(pathToArchive, whereToUnpack, (error) => {
			if (error) {
				reject(error);
			} else resolve();
		});
	});
}

// Main
let tmpDir: string | undefined;
try {
	// Arguments
	const argv = await yargs(hideBin(process.argv))
		.strict()
		.version(false)
		.usage('WebView\n\nUsage: $0 [options]')
		.option('architecture', {
			type: 'string',
			default: 'x64',
			choices: ['arm64', 'x64', 'x86'],
			requiresArg: true,
			description: 'Architecture'
		})
		.option('version', {
			type: 'string',
			default: 'latest',
			requiresArg: true,
			description: 'Version'
		})
		.option('output', {
			type: 'string',
			default: OUTPUT_DIR,
			requiresArg: true,
			description: 'Output directory'
		})
		.option('update', {
			type: 'boolean',
			default: true,
			requiresArg: true,
			description: 'Overwrite tauri.conf.json'
		})
		.check(async ({ version, output }) => {
			if (version !== 'latest' && !/^[0-9]+.[0-9]+.[0-9]+.[0-9]+$/.test(version)) {
				throw new Error(`Invalid version '${version}'`);
			}
			try {
				await fs.access(output);
			} catch (error) {
				throw new Error(`Invalid output directory '${output}' due to '${error}'`);
			}

			return true;
		})
		.parseAsync();

	// Data
	info(
		`Searching WebView data for version '${argv.version}' and architecture '${argv.architecture}'`
	);
	const data = await webViewData(
		WEBVIEW_URL,
		argv.version as Version,
		argv.architecture as Architecture
	);
	info(`WebView data is '${JSON.stringify(data)}'`);

	const { url, version, architecture } = data;
	const webviewDirname = `Microsoft.WebView2.FixedVersionRuntime.${version}.${architecture}`;
	const output = path.resolve(argv.output, webviewDirname);

	// Temporary directory
	info(`Creating temporary directory`);
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), path.sep));
	info(`Temporary directory is '${tmpDir}'`);

	const archive = path.resolve(tmpDir, `${webviewDirname}.cab`);
	const webview = path.resolve(tmpDir, webviewDirname);

	// Download
	info(`Downloading WebView from '${url}' to '${archive}'`);
	await fs.writeFile(archive, await download(url.toString()));
	info(`WebView downloaded to '${archive}'`);

	// Unpack
	info(`Extracting '${archive}' to '${tmpDir}'`);
	await unpack(archive, tmpDir);
	info(`WebView extracted to '${tmpDir}'`);

	// Check
	try {
		await fs.access(webview);
	} catch (error) {
		throw new Error(`WebView '${webview}' not found`);
	}

	// Move
	info(`Moving '${webview}' to '${output}'`);
	await fsExtra.move(webview, output, { overwrite: true });
	info(`WebView moved to '${output}'`);

	// Update
	if (argv.update) {
		info(`Updating Tauri configuration file '${TAURI_CONFIG_FILE}'`);
		const tauriConfig = await fsExtra.readJson(TAURI_CONFIG_FILE);
		tauriConfig.tauri.bundle.windows.webviewInstallMode.path = `./${webviewDirname}/`;
		const tauriConfigFormatted = await prettier.format(JSON.stringify(tauriConfig), {
			...((await prettier.resolveConfig(PRETTIER_CONFIG_FILE)) ?? {}),
			filepath: TAURI_CONFIG_FILE
		});
		await fs.writeFile(TAURI_CONFIG_FILE, tauriConfigFormatted);
		info(`Updated Tauri configuration file '${TAURI_CONFIG_FILE}'`);
	}
} catch (err) {
	error(`Error WebView: ${error}`);
	throw err;
} finally {
	// Remove temporary directory
	if (tmpDir) {
		try {
			await fs.rm(tmpDir, { recursive: true, force: true });
		} catch {
			/* empty */
		}
	}
}

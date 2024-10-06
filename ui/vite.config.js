import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';
import zlib from 'node:zlib';
import { promisify } from 'util';
import fs from 'fs/promises';
import { pascalCase } from "pascal-case";
import mime from 'mime';
import { createHtmlPlugin } from 'vite-plugin-html';
import strip from '@rollup/plugin-strip';

const gzip = promisify(zlib.gzip);

function hexdump(buffer) {
    let lines = [];
    for (let i = 0; i < buffer.length; i += 16) {
        let block = buffer.slice(i, i + 16);
        let hexArray = [];
        for (let value of block) {
            hexArray.push("0x" + value.toString(16).padStart(2, "0"));
        }
        let hexString = hexArray.join(", ");
        let line = `  ${hexString}`;
        lines.push(line);
    }
    return lines.join(",\n");
}

async function cppCompressed(input, fileName, contentType) {
    const result = await gzip(input, { level: zlib.constants.Z_BEST_COMPRESSION });
    console.info(fileName + " compressed " + result.length + " bytes");
    const array = hexdump(result);
    const src = `/*
 * Binary array for the Web UI.
 * Gzip is used for smaller size and improved speeds.
 */

// Autogenerated do not edit!!
const uint16_t ${fileName.replace(/[.-]/g, "_").toUpperCase()}_L = ${result.length};
const uint8_t ${fileName.replace(/[.-]/g, "_").toUpperCase()}[] PROGMEM = {
${array}
};

void serve${pascalCase(fileName.replace(/[.-]/g, "_"))}(AsyncWebServerRequest* request) {
  AsyncWebServerResponse *response = request->beginResponse_P(200, "${contentType || mime.getType(fileName)}", ${fileName.replace(/[.-]/g, "_").toUpperCase()}, ${fileName.replace(/[.-]/g, "_").toUpperCase()}_L);
  response->addHeader(F("Content-Encoding"), "gzip");
  request->send(response);
}
`;
    return src;
}

function cppPlugin() {
    return {
        name: 'cpp',
        async writeBundle(options, bundle) {
            for (const [fileName, file] of Object.entries(bundle)) {
                if (file.type === 'chunk' || file.type === 'asset') {
                    const content = file.type === 'chunk' ? file.code : file.source;
                    const compressedContent = await cppCompressed(content, fileName);

                    // Adjust the output path to be two directories up
                    let outputPath = resolve(__dirname, '../src/ui_' + fileName.replace(/[.-]/g, '_') + '.h');

                    // Ensure the directory exists
                    await fs.mkdir(resolve(__dirname, '..'), { recursive: true });

                    // Write the file
                    await fs.writeFile(outputPath, compressedContent);
                    console.log(`Generated: ${outputPath}`);
                }
            }
        }
    };
}

export default defineConfig({
    base: '/ui/',
    plugins: [
        svelte({
            emitCss: true,
        }),
        strip({
            include: '**/*.(js|ts|svelte)',
            functions: ['console.*', 'assert.*'],
        }),
        createHtmlPlugin({
            minify: true,
        }),
        cppPlugin()
    ],
    build: {
        outDir: 'dist',
        assetsDir: '.',
        minify: 'terser',
        terserOptions: {
            compress: {
                ecma: 2020,
                drop_console: true,
                passes: 3,
                toplevel: true,
                unsafe: true,
            },
            mangle: {
                toplevel: true,
            },
            output: {
                comments: false,
            },
        },
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html')
            },
            output: {
                entryFileNames: 'index.js',
                assetFileNames: 'bundle.css',
            },
        },
        cssCodeSplit: false, // This ensures a single CSS file
    }
});

/**
 * 上传脚本 - 将 snapshot/ 目录内容上传到 Cloudflare R2
 *
 * 用法：
 *   1. 在 .env 中填入 R2_ACCOUNT_ID、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY、R2_BUCKET_NAME
 *   2. node scripts/upload-r2.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import mime from 'mime-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_DIR = path.join(ROOT, 'snapshot');

// ---- 加载 .env ----
function loadEnv() {
    const envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) {
        console.error('未找到 .env 文件');
        process.exit(1);
    }
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
    }
}

loadEnv();

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET_NAME = process.env.R2_BUCKET_NAME;

if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY || !BUCKET_NAME) {
    console.error('请在 .env 中设置 R2_ACCOUNT_ID、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY、R2_BUCKET_NAME');
    process.exit(1);
}

const client = new S3Client({
    region: 'auto',
    endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY,
    },
});

// 递归获取目录下所有文件
function getAllFiles(dir, base = '') {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = base ? `${base}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            files.push(...getAllFiles(path.join(dir, entry.name), rel));
        } else {
            files.push(rel);
        }
    }
    return files;
}

async function main() {
    if (!fs.existsSync(SNAPSHOT_DIR)) {
        console.error('snapshot/ 目录不存在，请先运行 npm run snapshot');
        process.exit(1);
    }

    const files = getAllFiles(SNAPSHOT_DIR);
    console.log(`\n📤 准备上传 ${files.length} 个文件到 R2 bucket: ${BUCKET_NAME}\n`);

    let success = 0;
    let fail = 0;

    // 并发上传，每批 10 个
    const CONCURRENCY = 10;
    for (let i = 0; i < files.length; i += CONCURRENCY) {
        const batch = files.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(batch.map(async (file) => {
            const filePath = path.join(SNAPSHOT_DIR, file);
            const key = file.replace(/\\/g, '/');
            const contentType = mime.lookup(filePath) || 'application/octet-stream';
            const body = fs.readFileSync(filePath);

            await client.send(new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: key,
                Body: body,
                ContentType: contentType,
            }));
            const sizeMB = (body.length / 1024 / 1024).toFixed(2);
            console.log(`  ✓ ${key} (${sizeMB} MB, ${contentType})`);
        }));

        for (let j = 0; j < results.length; j++) {
            if (results[j].status === 'fulfilled') {
                success++;
            } else {
                console.log(`  ✗ ${batch[j]} - ${results[j].reason?.message}`);
                fail++;
            }
        }
    }

    console.log(`\n✅ 上传完成！成功 ${success}，失败 ${fail}`);
}

main().catch(err => {
    console.error('上传失败:', err);
    process.exit(1);
});

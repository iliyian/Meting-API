/**
 * 快照抓取脚本 — 趁 QQ_MUSIC_KEY 有效时，一次性下载 playlist 的所有资源
 *
 * 用法：
 *   1. 复制 .env.example 为 .env，填入 QQ_UIN、QQ_MUSIC_KEY、R2_BASE_URL
 *   2. node scripts/snapshot.js
 *   3. 将 snapshot/ 目录内容上传到 R2 bucket
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---- 加载 .env ----
function loadEnv() {
    const envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) {
        console.error('❌ 未找到 .env 文件，请复制 .env.example 为 .env 并填入配置');
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

const QQ_UIN = process.env.QQ_UIN || '';
const QQ_MUSIC_KEY = process.env.QQ_MUSIC_KEY || '';
const R2_BASE_URL = (process.env.R2_BASE_URL || '').replace(/\/$/, '');
const PLAYLIST_ID = process.env.SNAPSHOT_PLAYLIST_ID || '2374187585';
const OUTPUT_DIR = path.join(ROOT, 'snapshot');

if (!R2_BASE_URL) {
    console.error('❌ 请在 .env 中设置 R2_BASE_URL');
    process.exit(1);
}

// ---- QQ 音乐 API 工具函数 ----
function changeUrlQuery(data, baseUrl) {
    const url = new URL(baseUrl);
    for (const [k, v] of Object.entries(data)) {
        url.searchParams.set(k, v);
    }
    return url.toString();
}

// 获取播放列表
async function fetchPlaylist(id) {
    const data = {
        type: 1, utf8: 1, disstid: id, loginUin: 0, format: 'json'
    };
    const url = changeUrlQuery(data, 'http://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg');
    const res = await fetch(url, {
        headers: { Referer: 'https://y.qq.com/n/yqq/playlist' }
    });
    const json = await res.json();
    return json.cdlist[0].songlist;
}

// 批量获取音频 URL（单批，最多 100 首）
async function fetchSongUrlsBatch(songmids) {
    const guid = (Math.random() * 10000000).toFixed(0);
    const reqData = {
        req_0: {
            module: 'vkey.GetVkeyServer',
            method: 'CgiGetVkey',
            param: {
                guid, songmid: songmids, songtype: [0],
                uin: QQ_UIN, loginflag: 1, platform: '20',
            },
        },
        comm: {
            uin: QQ_UIN, format: 'json', ct: 19, cv: 0, authst: QQ_MUSIC_KEY,
        },
    };
    const params = {
        '-': 'getplaysongvkey', g_tk: 5381, loginUin: QQ_UIN,
        hostUin: 0, format: 'json', inCharset: 'utf8',
        outCharset: 'utf-8\xACice=0', platform: 'yqq.json',
        needNewCode: 0, data: JSON.stringify(reqData),
    };
    const url = changeUrlQuery(params, 'https://u.y.qq.com/cgi-bin/musicu.fcg');
    const res = await fetch(url);
    const json = await res.json();

    const urls = [];
    const domain = json.req_0.data.sip.find(i => !i.startsWith('http://ws')) || json.req_0.data.sip[0];
    for (const info of json.req_0.data.midurlinfo) {
        urls.push(info.purl ? `${domain}${info.purl}`.replace('http://', 'https://') : '');
    }
    return urls;
}

// 批量获取音频 URL（自动分批，每批最多 100 首）
const BATCH_SIZE = 100;
async function fetchSongUrls(songmids) {
    const allUrls = [];
    for (let i = 0; i < songmids.length; i += BATCH_SIZE) {
        const batch = songmids.slice(i, i + BATCH_SIZE);
        console.log(`   批次 ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(songmids.length / BATCH_SIZE)}（${batch.length} 首）`);
        const urls = await fetchSongUrlsBatch(batch);
        allUrls.push(...urls);
        if (i + BATCH_SIZE < songmids.length) {
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    return allUrls;
}

// 获取歌词
async function fetchLyric(songmid) {
    const data = {
        songmid, pcachetime: Date.now(), g_tk: 5381, loginUin: 0,
        hostUin: 0, inCharset: 'utf8', outCharset: 'utf-8',
        notice: 0, platform: 'yqq', needNewCode: 0, format: 'json',
    };
    const url = changeUrlQuery(data, 'http://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg');
    const res = await fetch(url, { headers: { Referer: 'https://y.qq.com' } });
    const json = await res.json();

    const lyric = decodeURIComponent(escape(atob(json.lyric || '')));
    const trans = decodeURIComponent(escape(atob(json.trans || '')));
    return { lyric, trans };
}

// 格式化歌词（合并翻译，与 src/util.js 中的 format 逻辑一致）
function formatLyric(lyric, tlyric) {
    const parse = (text) => {
        const result = [];
        for (const line of text.split('\n')) {
            const m = line.match(/^\[(\d{2}):(\d{2}\.\d*)\](.*)$/);
            if (m) {
                result.push({
                    time: parseInt(m[1], 10) * 60 * 1000 + parseFloat(m[2]) * 1000,
                    text: m[3],
                });
            }
        }
        return result.sort((a, b) => a.time - b.time);
    };

    const lyricArr = parse(lyric);
    const tlyricArr = parse(tlyric);
    if (tlyricArr.length === 0) return lyric;

    const result = [];
    for (let i = 0, j = 0; i < lyricArr.length && j < tlyricArr.length; i++) {
        const time = lyricArr[i].time;
        let text = lyricArr[i].text;
        while (time > tlyricArr[j].time && j + 1 < tlyricArr.length) j++;
        if (time === tlyricArr[j].time && tlyricArr[j].text.length) {
            text = `${text} (${tlyricArr[j].text})`;
        }
        const min = Math.floor(time / 60000).toString().padStart(2, '0');
        const sec = Math.floor((time % 60000) / 1000).toString().padStart(2, '0');
        const ms = Math.floor(time % 1000).toString().padStart(3, '0');
        result.push(`[${min}:${sec}.${ms}]${text}`);
    }
    return result.join('\n');
}

// 下载文件到本地
async function downloadFile(url, filepath) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filepath, buffer);
    const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
    console.log(`  ✓ ${path.basename(filepath)} (${sizeMB} MB)`);
}

// ---- 主流程 ----
async function main() {
    console.log(`\n🎵 开始抓取 playlist ${PLAYLIST_ID}\n`);

    // 创建输出目录
    for (const dir of ['music', 'pic', 'lrc']) {
        fs.mkdirSync(path.join(OUTPUT_DIR, dir), { recursive: true });
    }

    // 1. 获取播放列表
    console.log('📋 获取播放列表...');
    const songlist = await fetchPlaylist(PLAYLIST_ID);
    console.log(`   共 ${songlist.length} 首歌\n`);

    // 2. 批量获取音频 URL
    console.log('🔗 获取音频 URL...');
    const songmids = songlist.map(s => s.songmid);
    const audioUrls = await fetchSongUrls(songmids);
    console.log(`   获取到 ${audioUrls.filter(u => u).length}/${songmids.length} 个有效 URL\n`);

    // 输出无法获取 URL 的歌曲
    const noUrlSongs = songlist.filter((s, i) => !audioUrls[i]);
    if (noUrlSongs.length > 0) {
        console.log('⚠ 以下歌曲无法获取音频 URL（可能是 VIP 或已下架）:');
        noUrlSongs.forEach(s => {
            const author = s.singer.reduce((acc, v) => (acc ? acc + ' / ' : '') + v.name, '');
            console.log(`   - ${s.songname} - ${author} (${s.songmid})`);
        });
        console.log('');
    }

    const playlist = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < songlist.length; i++) {
        const song = songlist[i];
        const mid = song.songmid;
        const author = song.singer.reduce((acc, v) => (acc ? acc + ' / ' : '') + v.name, '');
        const title = song.songname;
        const picUrl = `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.albummid}.jpg`;
        const audioUrl = audioUrls[i];

        console.log(`[${i + 1}/${songlist.length}] ${title} - ${author}`);

        try {
            // 下载音频
            if (audioUrl) {
                await downloadFile(audioUrl, path.join(OUTPUT_DIR, `music/${mid}.m4a`));
            } else {
                console.log('  ⚠ 无音频 URL（可能是 VIP 歌曲或 key 已过期）');
            }

            // 下载封面
            await downloadFile(picUrl, path.join(OUTPUT_DIR, `pic/${mid}.jpg`));

            // 获取歌词（格式化并合并翻译）
            const { lyric, trans } = await fetchLyric(mid);
            const lrcContent = formatLyric(lyric, trans);
            fs.writeFileSync(path.join(OUTPUT_DIR, `lrc/${mid}.lrc`), lrcContent, 'utf-8');
            console.log(`  ✓ ${mid}.lrc`);

            // 构建 playlist 条目
            playlist.push({
                author,
                title,
                pic: `${R2_BASE_URL}/pic/${mid}.jpg`,
                url: audioUrl ? `${R2_BASE_URL}/music/${mid}.m4a` : '',
                lrc: `${R2_BASE_URL}/lrc/${mid}.lrc`,
            });

            successCount++;
        } catch (err) {
            console.log(`  ❌ 失败: ${err.message}`);
            failCount++;
        }

        // 延迟避免限流（10秒）
        if (i < songlist.length - 1) {
            console.log('  ⏳ 等待 0.6 秒...');
            await new Promise(r => setTimeout(r, 600));
        }
    }

    // 保存 playlist JSON
    const playlistPath = path.join(OUTPUT_DIR, 'playlist.json');
    fs.writeFileSync(playlistPath, JSON.stringify(playlist, null, 2), 'utf-8');

    console.log(`\n✅ 完成！成功 ${successCount} 首，失败 ${failCount} 首`);
    console.log(`📁 输出目录: ${OUTPUT_DIR}`);
    console.log(`📄 播放列表: ${playlistPath}`);
    console.log(`\n下一步: 将 snapshot/ 目录内容上传到 R2 bucket`);
}

main().catch(err => {
    console.error('❌ 脚本执行失败:', err);
    process.exit(1);
});

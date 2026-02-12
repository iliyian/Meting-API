import Providers from "../providers/index.js"
import { format as lyricFormat, get_url } from "../util.js"

// ---- 静态快照配置 ----
// 对特定 playlist 直接返回 R2 上的静态资源，无需 QQ_MUSIC_KEY
const R2_BASE_URL = (globalThis?.Deno?.env?.get("R2_BASE_URL") || globalThis?.process?.env?.R2_BASE_URL || '').replace(/\/$/, '')
const SNAPSHOT_PLAYLIST_IDS = (globalThis?.Deno?.env?.get("SNAPSHOT_PLAYLIST_ID") || globalThis?.process?.env?.SNAPSHOT_PLAYLIST_ID || '')
    .split(',').map(s => s.trim()).filter(Boolean)

// 内存缓存，避免每次请求都 fetch R2
const snapshotCache = {}

async function getSnapshotPlaylist(playlistId) {
    if (!R2_BASE_URL || !SNAPSHOT_PLAYLIST_IDS.includes(playlistId)) return null
    if (snapshotCache[playlistId]) return snapshotCache[playlistId]
    try {
        const res = await fetch(`${R2_BASE_URL}/playlist.json`)
        if (!res.ok) return null
        const data = await res.json()
        snapshotCache[playlistId] = data
        return data
    } catch {
        return null
    }
}

export default async (ctx) => {

    const p = new Providers()

    const query = ctx.req.query()
    const server = query.server || 'tencent'
    const type = query.type || 'playlist'
    const id = query.id || '7326220405'

    if (!p.get_provider_list().includes(server) || !p.get(server).support_type.includes(type)) {
        ctx.status(400)
        return ctx.json({ status: 400, message: 'server 参数不合法', param: { server, type, id } })
    }

    // ---- 静态快照回退：对特定 tencent playlist 直接返回 R2 资源 ----
    // playlist.json 中的 url/pic/lrc 已经是 R2 直链，APlayer 会直接请求 R2
    if (server === 'tencent' && type === 'playlist' && R2_BASE_URL) {
        const snapshot = await getSnapshotPlaylist(id)
        if (snapshot) {
            return ctx.json(snapshot)
        }
    }

    let data = await p.get(server).handle(type, id)

    if (type === 'url') {
        let url = data

        if (!url) {
            ctx.status(403)
            return ctx.json({ error: 'no url' })
        }
        if (url.startsWith('@'))
            return ctx.text(url)

        return ctx.redirect(url)
    }

    if (type === 'pic') {
        return ctx.redirect(data)
    }

    if (type === 'lrc') {
        return ctx.text(lyricFormat(data.lyric, data.tlyric || ''))
    }


    // json 类型数据填充api
    return ctx.json(data.map(x => {
        for (let i of ['url', 'pic', 'lrc']) {
            const _ = String(x[i])
            // 正常对象_均为id，以下例外不用填充：1.@开头/size为0=>qq音乐jsonp 2.已存在完整链接
            if (!_.startsWith('@') && !_.startsWith('http') && _.length > 0) {
                x[i] = `${get_url(ctx)}?server=${server}&type=${i}&id=${_}`
            }
        }
        return x
    }))
}

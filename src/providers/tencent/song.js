import { changeUrlQuery } from "./util.js"
import config from "../../config.js"

// 从环境变量获取 QQ 音乐的登录凭证，用于获取 VIP 歌曲
const getQQCredentials = () => {
    let uin = globalThis?.Deno?.env?.get("QQ_UIN") || globalThis?.process?.env?.QQ_UIN || ''
    let qqmusic_key = globalThis?.Deno?.env?.get("QQ_MUSIC_KEY") || globalThis?.process?.env?.QQ_MUSIC_KEY || ''
    return { uin, qqmusic_key }
}

// 批量获取歌曲的真实音频 URL（后端直接请求，不使用 JSONP）
export const get_song_url_direct = async (ids, cookie = '') => {
    const { uin, qqmusic_key } = getQQCredentials()
    const guid = (Math.random() * 10000000).toFixed(0);

    let data = {
        req_0: {
            module: 'vkey.GetVkeyServer',
            method: 'CgiGetVkey',
            param: {
                guid: guid,
                songmid: ids,
                songtype: [0],
                uin: uin,
                loginflag: 1,
                platform: '20',
            },
        },
        comm: {
            uin: uin,
            format: 'json',
            ct: 19,
            cv: 0,
            authst: qqmusic_key,
        },
    }

    let params = {
        '-': 'getplaysongvkey',
        g_tk: 5381,
        loginUin: uin,
        hostUin: 0,
        format: 'json',
        inCharset: 'utf8',
        outCharset: 'utf-8¬ice=0',
        platform: 'yqq.json',
        needNewCode: 0,
        data: JSON.stringify(data),
    }

    const url = changeUrlQuery(params, 'https://u.y.qq.com/cgi-bin/musicu.fcg')
    let result = await fetch(url);
    result = await result.json()

    const urls = []
    const domain = result.req_0.data.sip.find(i => !i.startsWith('http://ws')) || result.req_0.data.sip[0];
    for (const info of result.req_0.data.midurlinfo) {
        urls.push(info.purl ? `${domain}${info.purl}`.replace('http://', 'https://') : '')
    }
    return urls
}

export const get_song_url = async (id, cookie = '') => {

    id = id.split(',')
    const { uin, qqmusic_key } = getQQCredentials()
    const typeObj = {
        s: 'M500',
        e: '.mp3',
    }

    const file = id.map(e => `${typeObj.s}${e}${e}${typeObj.e}`)
    const guid = (Math.random() * 10000000).toFixed(0);

    let purl = '';

    let data = {
        req_0: {
            module: 'vkey.GetVkeyServer',
            method: 'CgiGetVkey',
            param: {
                // filename: file,
                guid: guid,
                songmid: id,
                songtype: [0],
                uin: uin,
                loginflag: 1,
                platform: '20',
            },
        },
        comm: {
            uin: uin,
            format: 'json',
            ct: 19,
            cv: 0,
            authst: qqmusic_key,
        },
    }

    let params = {
        '-': 'getplaysongvkey',
        g_tk: 5381,
        loginUin: uin,
        hostUin: 0,
        format: 'json',
        inCharset: 'utf8',
        outCharset: 'utf-8¬ice=0',
        platform: 'yqq.json',
        needNewCode: 0,
        data: JSON.stringify(data),
    }


    // 移除 OVERSEAS 的 JSONP 逻辑，始终由后端直接请求


    const url = changeUrlQuery(params, 'https://u.y.qq.com/cgi-bin/musicu.fcg')

    let result = await fetch(url);

    result = await result.json()
    // console.log(result)
    if (result.req_0 && result.req_0.data && result.req_0.data.midurlinfo) {
        purl = result.req_0.data.midurlinfo[0].purl;
    }

    const domain =
        result.req_0.data.sip.find(i => !i.startsWith('http://ws')) ||
        result.req_0.data.sip[0];

    const res = `${domain}${purl}`.replace('http://', 'https://')
    // console.log(res);
    return res;

}

export const get_song_info = async (id, cookie = '') => {
    const data = {
        data: JSON.stringify({
            songinfo: {
                method: 'get_song_detail_yqq',
                module: 'music.pf_song_detail_svr',
                param: {
                    song_mid: id,
                },
            },
        }),
    };

    const url = changeUrlQuery(data, 'http://u.y.qq.com/cgi-bin/musicu.fcg');

    let result = await fetch(url);

    result = await result.json()

    result = result.songinfo.data

    let song_info = {
        author: result.track_info.singer.reduce((i, v) => ((i ? i + " / " : i) + v.name), ''),
        title: result.track_info.name,
        pic: `https://y.gtimg.cn/music/photo_new/T002R300x300M000${result.track_info.album.mid}.jpg`,
        url: config.OVERSEAS ? await get_song_url(id) : id,
        lrc: id,
        songmid: id,
    }
    // console.log(song_info)
    return [song_info]
}

export const get_pic = async (id, cookie = '') => {
    const info = await get_song_info(id, cookie)
    return info[0].pic
}

// const res = await get_song_url('002Rnpvi058Qdm');
// console.log(res)

// const res = await get_song_url('002Rnpvi058Qdm,000i26Sh1ZyiNU');
// console.log(res)

// const res = await get_song_info('002Rnpvi058Qdm');
// console.log(res)

import config from "../../config.js"
import { get_song_url, get_song_url_direct } from "./song.js"
import { changeUrlQuery } from "./util.js"

const get_playlist = async (id, cookie = '') => {
    const data = {
        type: 1,
        utf8: 1,
        disstid: id,
        loginUin: 0,
        format: 'json'
    }


    const headers = {
        Referer: 'https://y.qq.com/n/yqq/playlist',
    }

    const url = changeUrlQuery(data, 'http://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg')

    let result = await fetch(url, { headers });

    result = await result.json()
    result = result.cdlist[0].songlist

    // 无论是否 OVERSEAS，都由后端直接获取音频 URL
    const ids = result.map(song => song.songmid)
    const urls = await get_song_url_direct(ids)
    
    const res = result.map((song, index) => {
        let song_info = {
            author: song.singer.reduce((i, v) => ((i ? i + " / " : i) + v.name), ''),
            title: song.songname,
            pic: `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.albummid}.jpg`,
            url: urls[index] || song.songmid,
            lrc: song.songmid,
            songmid: song.songmid,
        }
        return song_info
    });

    return res;
}


// const res = await get_playlist('7326220405')
// console.log(res)

export { get_playlist }

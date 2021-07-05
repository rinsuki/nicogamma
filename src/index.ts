import { App } from "piyo"
import fs from "fs"
import * as z from "zod"
import KoaLogger from "koa-logger"

const app = new App()

const DATA_DIR = __dirname+"/../data/"

function isValidVideoID(id: string) {
    return /^[a-z0-9]+$/.test(id)
}

async function getVideoData(id: string) {
    const info = z.object({
        thread: z.number(),
        file: z.string(),
    }).parse(JSON.parse(await fs.promises.readFile(DATA_DIR+`/videos/${id}/data.json`, { encoding: "utf-8"})))
    return {
        ...info,
        file: DATA_DIR+`/videos/${id}/${info.file}`
    }
}

function escapeXML(input: string) {
    return input.replace(/&/, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

app.all(/.*/, KoaLogger())

app.get("/", async ctx => {
    const dirs = await fs.promises.readdir(DATA_DIR+"/videos/")

    let body = `<html><meta charset="UTF-8"><title>nicogamma</title><h1>nicogamma</h1><h2>videos</h2><ul>`
    for (const dir of dirs) {
        if (!isValidVideoID(dir)) continue
        body += `<li><a href="/watch?v=${dir}">${dir}</a></li>`
    }
    body += `</ul>`
    ctx.body = body
})

app.get("/watch", async ctx => {
    const v = z.string().parse(ctx.query.v)
    if (!isValidVideoID(v)) {
        ctx.status = 404
        ctx.body = `<meta charset="UTF-8">invalid video id... <a href="/">back to top</a><!-- ${" ".repeat(1024)} -->`
    }
    const dir = DATA_DIR+"/videos/" + v
    if (!fs.existsSync(dir)) {
        ctx.status = 404
        ctx.body = `<meta charset="UTF-8">video not found... <a href="/">back to top</a><!-- ${" ".repeat(1024)} -->`
    }
    let body = `<meta charset="UTF-8"><title>${v} - nicogamma</title><h1>${v} - nicogamma <a href="/">back</a></h1>`
    body += `<embed type="application/x-shockwave-flash" src="flvplayer.swf" quality="high" bgcolor="#888888" flashvars="v=${v}&amp;videoId=${v}" width="960" height="540"/>`
    ctx.body = body
})

app.get("/flvplayer.swf", async ctx => {
    ctx.body = fs.createReadStream(DATA_DIR+"/flvplayer.swf")
})

app.get("/getflv", async ctx => {
    ctx.set("Cache-Control", "no-store, no-cache")
    const res: {[key: string]: string | number | undefined} = await (async () => {
        const v = z.string().parse(ctx.query.v)
        if (!isValidVideoID(v)) {
            return {error: "invalid id"}
        }
        const info = await getVideoData(v)
        const stat = await fs.promises.stat(info.file)
        return {
            url: "smile?v=" + v,
            l: stat.size,
            ms: "api/comment",
            thread_id: info.thread,
        }
    })()
    ctx.body = Object.entries(res).map(args => args.map(a => encodeURIComponent(a?.toString() ?? "")).join("=")).join("&")
})

app.get("/smile", async ctx => {
    const v = z.string().parse(ctx.query.v)
    if (!isValidVideoID(v)) return ctx.throw(400)
    const info = await getVideoData(v)
    ctx.body = fs.createReadStream(info.file)
})

app.post("/api/comment", async ctx => {
    let chunks = []
    for await (const chunk of ctx.req) {
        chunks.push(chunk)
    }
    const reqbody = Buffer.concat(chunks).toString("ascii")
    const request = /<thread res_from="(-?[0-9]{1,10})" version="20061206" thread="([0-9]{1,12})" \/>/.exec(reqbody)
    if (request == null) {
        console.log("unknown request", reqbody)
        ctx.status = 400
        return
    }
    const thread = parseInt(request[2], 10)
    const serverTime = Math.floor(Date.now() / 1000)
    
    let body = `<packet>`
    // from ttps://nmsg.nicovideo.jp/api.json/thread?version=20061206&res_from=-1000&thread=THREAD_ID
    const json = JSON.parse(await fs.readFileSync(DATA_DIR+`/threads/${thread}.json`, { encoding: "utf-8" }))
    if (!request[1].startsWith("-")) { // ignore refresh
        body += `<thread resultcode="0" thread="${thread}" server_time="${serverTime}" last_res="${request[1]}" ticket="0x00000000" revision="1" />`
    } else {
        for (const packet of json) {
            if ("thread" in packet) {
                body += `<thread resultcode="0" thread="${thread}" server_time="${serverTime}" last_res="${packet.thread.last_res}" ticket="0x00000000" revision="1" />`
            } else {
                body += `<chat`
                let content = ""
                console.log(packet.chat)
                for (const [key, value] of Object.entries(packet.chat)) {
                    if (typeof value !== "string" && typeof value !== "number") {
                        console.warn("dame invalid value", value)
                        continue
                    }
                    if (key === "content") {
                        content = value.toString()
                        continue
                    }
                    body += ` ${key}="${escapeXML(value.toString())}"`
                }
                body += `>${escapeXML(content)}</chat>`
            }
        }
    }

    console.log(body)
    body += `</packet>`
    ctx.body = body
})

app.listen(3000)

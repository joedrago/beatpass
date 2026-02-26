import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { extname, join } from "node:path"

const MIME = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml"
}

const PORT = process.env.PORT || 3000

const server = createServer(async (req, res) => {
    let url = req.url.split("?")[0]
    if (url === "/") url = "/index.html"

    const filePath = join(process.cwd(), url)
    const ext = extname(filePath)
    const mime = MIME[ext] || "application/octet-stream"

    try {
        const data = await readFile(filePath)
        res.writeHead(200, { "Content-Type": mime })
        res.end(data)
    } catch (_err) {
        res.writeHead(404, { "Content-Type": "text/plain" })
        res.end("404 Not Found")
    }
})

server.listen(PORT, () => {
    console.log(`BeatPass dev server running at http://localhost:${PORT}`)
})

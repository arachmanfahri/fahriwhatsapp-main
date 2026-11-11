"use strict"

const DEFAULT_TIMEOUT_MS = 10000

function clip(value, max) {
    const text = String(value || "").replace(/\s+/g, " ").trim()
    return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function extractHttpUrl(value) {
    const match = String(value || "").match(/https?:\/\/[^\s<>]+/i)
    if (!match) return ""
    const candidate = match[0].replace(/[),.;!?]+$/g, "")
    try {
        const parsed = new URL(candidate)
        return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : ""
    } catch {
        return ""
    }
}

function getFallbackTitle(url) {
    try {
        return new URL(url).hostname.replace(/^www\./i, "")
    } catch {
        return "Link"
    }
}

function getYouTubeVideoId(value) {
    try {
        const parsed = new URL(value)
        const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase()
        let videoId = ""
        if (hostname === "youtu.be") videoId = parsed.pathname.split("/").filter(Boolean)[0] || ""
        else if (["youtube.com", "m.youtube.com", "music.youtube.com"].includes(hostname)) {
            if (parsed.pathname === "/watch") videoId = parsed.searchParams.get("v") || ""
            else if (/^\/(?:shorts|embed|live)\//i.test(parsed.pathname)) videoId = parsed.pathname.split("/").filter(Boolean)[1] || ""
        }
        return /^[A-Za-z0-9_-]{6,20}$/.test(videoId) ? videoId : ""
    } catch {
        return ""
    }
}

async function fetchWithTimeout(url, timeoutMs) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        return await fetch(url, {
            signal: controller.signal,
            headers: { "user-agent": "Mozilla/5.0 (compatible; USERBOT-LinkCard/1.0)" },
        })
    } finally {
        clearTimeout(timer)
    }
}

async function getYouTubeCardInfo(url, options = {}) {
    const videoId = getYouTubeVideoId(url)
    if (!videoId) return null

    const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`
    const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    let metadata = {}
    try {
        const response = await fetchWithTimeout(
            `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`,
            timeoutMs,
        )
        if (response.ok) metadata = await response.json()
    } catch (error) {
        options.logger?.warn?.(`[LINK CARD] Metadata YouTube gagal: ${error.message}`)
    }

    let thumbnail
    try {
        const response = await fetchWithTimeout(thumbnailUrl, timeoutMs)
        const contentLength = Number(response.headers.get("content-length") || 0)
        if (response.ok && (!contentLength || contentLength <= 2 * 1024 * 1024)) {
            const buffer = Buffer.from(await response.arrayBuffer())
            if (buffer.length <= 2 * 1024 * 1024) thumbnail = buffer
        }
    } catch (error) {
        options.logger?.warn?.(`[LINK CARD] Thumbnail YouTube gagal: ${error.message}`)
    }

    return {
        title: metadata.title || "Video YouTube",
        description: metadata.author_name ? `YouTube • ${metadata.author_name}` : "Ketuk untuk menonton di YouTube",
        thumbnail,
        thumbnailUrl,
    }
}

async function buildExternalLinkCard(value, options = {}) {
    const originalText = String(value || "").trim()
    const url = extractHttpUrl(originalText)
    if (!url) return { text: originalText }

    const info = await getYouTubeCardInfo(url, options)

    const externalAdReply = {
        title: clip(info?.title || getFallbackTitle(url), 120),
        body: clip(info?.description || "Ketuk kartu untuk membuka link", 180),
        mediaType: 1,
        sourceUrl: url,
        mediaUrl: url,
        renderLargerThumbnail: true,
        showAdAttribution: false,
        containsAutoReply: true,
    }

    if (info?.thumbnail) externalAdReply.thumbnail = Buffer.from(info.thumbnail)
    if (info?.thumbnailUrl) externalAdReply.thumbnailUrl = info.thumbnailUrl

    const bareUrl = originalText.replace(/[),.;!?]+$/g, "") === url.replace(/[),.;!?]+$/g, "")
    return {
        text: bareUrl ? "🎬 Ketuk kartu di bawah untuk membuka videonya." : originalText,
        contextInfo: { externalAdReply },
    }
}

module.exports = {
    buildExternalLinkCard,
    extractHttpUrl,
    getYouTubeVideoId,
}

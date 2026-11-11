"use strict"

const fs = require("fs")
const path = require("path")

function safePackageVersion() {
    try {
        return String(require("@whiskeysockets/baileys/package.json").version || "unknown")
    } catch {
        return "unknown"
    }
}

function installedSourceContains(relativePath, pattern) {
    try {
        const packagePath = require.resolve("@whiskeysockets/baileys/package.json")
        const source = fs.readFileSync(path.join(path.dirname(packagePath), relativePath), "utf8")
        return pattern.test(source)
    } catch {
        return false
    }
}

function hasPrototypeMethod(value, method) {
    return Boolean(value && typeof value.prototype?.[method] === "function")
}

function inspectBaileysCapabilities(options = {}) {
    const baileys = options.baileys || null
    const sock = options.sock || null
    const messageTypes = installedSourceContains("lib/Types/Message.d.ts", /\bmentionAll\??\s*:/)
    const albumParentKey = installedSourceContains("lib/Types/Message.d.ts", /\balbumParentKey\??\s*:/)
    const albumEnvelope = installedSourceContains("lib/Types/Message.d.ts", /\balbum\s*:\s*AlbumMessageOptions/)
    const usyncQuery = baileys?.USyncQuery
    const usyncUser = baileys?.USyncUser

    return {
        installedVersion: safePackageVersion(),
        nativeMentionAll: messageTypes,
        nativeAlbum: albumParentKey && albumEnvelope && Boolean(baileys?.proto?.Message?.AlbumMessage),
        memberLabel: typeof sock?.updateMemberLabel === "function"
            && Boolean(baileys?.proto?.Message?.ProtocolMessage?.Type?.GROUP_MEMBER_LABEL_CHANGE),
        memberLabelRead: Boolean(baileys?.proto?.MemberLabel),
        usernameUsync: typeof sock?.executeUSyncQuery === "function"
            && hasPrototypeMethod(usyncQuery, "withUsernameProtocol")
            && hasPrototypeMethod(usyncUser, "withId"),
        usernameMutation: false,
        newsletter: {
            metadata: typeof sock?.newsletterMetadata === "function",
            follow: typeof sock?.newsletterFollow === "function",
            unfollow: typeof sock?.newsletterUnfollow === "function",
        },
    }
}

function capabilityStatus(value) {
    return value ? "SUPPORTED" : "UNSUPPORTED"
}

function formatCapabilityReport(capabilities) {
    const caps = capabilities || inspectBaileysCapabilities()
    return [
        `Baileys installed: ${caps.installedVersion}`,
        `Native mentionAll: ${capabilityStatus(caps.nativeMentionAll)}`,
        `Native album parent/child: ${capabilityStatus(caps.nativeAlbum)}`,
        `Member label write (self label): ${capabilityStatus(caps.memberLabel)}`,
        `Member label read: ${capabilityStatus(caps.memberLabelRead)}`,
        `Username USync lookup: ${capabilityStatus(caps.usernameUsync)}`,
        "Username mutation: UNSUPPORTED (tidak ada API socket terverifikasi)",
        `Newsletter metadata: ${capabilityStatus(caps.newsletter?.metadata)}`,
        `Newsletter follow: ${capabilityStatus(caps.newsletter?.follow)}`,
        `Newsletter unfollow: ${capabilityStatus(caps.newsletter?.unfollow)}`,
    ].join("\n")
}

module.exports = {
    formatCapabilityReport,
    inspectBaileysCapabilities,
}

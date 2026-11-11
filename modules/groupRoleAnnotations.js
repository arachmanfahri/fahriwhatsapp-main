"use strict"

const path = require("path")
const { createAtomicJsonStore } = require("./atomicJsonStore")
const canonicalIdentity = require("./canonicalIdentity")
const groupRuntimePolicy = require("./groupRuntimePolicy")
const common = require("./groupUtilityCommon")
const { inspectBaileysCapabilities } = require("./baileysCapabilities")

const DATA_FILE = path.join(__dirname, "..", "data", "groupRoleAnnotations.json")
const COMMAND_RE = /^\.(grouprole|memberlabel)(?:\s|$)/i
const ROLE_MAX = 30

const store = createAtomicJsonStore({
    filePath: DATA_FILE,
    envName: "GROUP_ROLE_ANNOTATIONS_FILE",
    label: "GROUP ROLE ANNOTATIONS",
    defaultState: () => ({ version: 1, groups: {} }),
})

function normalizeGroupJid(value) {
    const jid = groupRuntimePolicy.normalizeJid(value)
    return groupRuntimePolicy.isGroupJid(jid) ? jid : ""
}

function identityKey(values, context = {}) {
    return canonicalIdentity.canonicalIdentity(Array.isArray(values) ? values : [values], context)?.key || ""
}

function sanitizeRole(value) {
    const role = String(value || "").replace(/@[0-9]+/g, "").replace(/\s+/g, " ").trim().slice(0, ROLE_MAX)
    if (!role) return ""
    if (/\b(admin|administrator|owner|pemilik|superadmin|creator)\b/i.test(role)) return ""
    return role
}

function getGroupRoles(groupJid) {
    const jid = normalizeGroupJid(groupJid)
    const roles = store.snapshot().groups?.[jid]?.roles
    return roles && typeof roles === "object" ? { ...roles } : {}
}

function getRole(groupJid, values, context = {}) {
    const key = identityKey(values, context)
    return key ? (getGroupRoles(groupJid)[key] || null) : null
}

function setRole(groupJid, values, role, context = {}, actor = "") {
    const jid = normalizeGroupJid(groupJid)
    const key = identityKey(values, context)
    const cleanRole = sanitizeRole(role)
    if (!jid || !key || !cleanRole) throw new Error("Grup, anggota, atau role lokal tidak valid")
    store.update(state => {
        const group = state.groups?.[jid] || { roles: {} }
        return {
            ...state,
            groups: {
                ...(state.groups || {}),
                [jid]: {
                    ...group,
                    roles: {
                        ...(group.roles || {}),
                        [key]: {
                            role: cleanRole,
                            updatedAt: new Date().toISOString(),
                            updatedBy: String(actor || "").slice(0, 120),
                        },
                    },
                },
            },
        }
    })
    return cleanRole
}

function clearRole(groupJid, values, context = {}) {
    const jid = normalizeGroupJid(groupJid)
    const key = identityKey(values, context)
    let removed = false
    if (!jid || !key) return removed
    store.update(state => {
        const group = state.groups?.[jid]
        if (!group?.roles?.[key]) return state
        const roles = { ...group.roles }
        delete roles[key]
        removed = true
        return {
            ...state,
            groups: { ...(state.groups || {}), [jid]: { ...group, roles } },
        }
    })
    return removed
}

function participantValues(participant) {
    return common.getParticipantCandidates(participant)
}

function findRoleTarget(metadata, msg, context) {
    return common.resolveTargetParticipant(metadata, msg, context)
}

function formatNativeLabel(value) {
    if (!value) return "belum ada"
    if (typeof value === "string") return value.slice(0, ROLE_MAX)
    return String(value.label || "belum ada").slice(0, ROLE_MAX)
}

async function handleMemberLabel(sock, msg, context, access, argument) {
    const capabilities = inspectBaileysCapabilities({ baileys: context.baileys, sock })
    const [actionRaw, ...rest] = String(argument || "").trim().split(/\s+/)
    const action = String(actionRaw || "status").toLowerCase()
    const botCandidates = groupRuntimePolicy.getBotIdentityCandidates(sock)
    const selfParticipant = (access.policy.metadata?.participants || [])
        .find(participant => groupRuntimePolicy.participantMatches(participant, botCandidates))

    if (action === "status") {
        await sock.sendMessage(access.groupJid, {
            text: [
                "Member label native hanya milik akun bot/userbot sendiri; ini bukan role admin.",
                `Label saat ini: ${formatNativeLabel(selfParticipant?.memberLabel)}`,
                `Write API: ${capabilities.memberLabel ? "SUPPORTED" : "UNSUPPORTED"}`,
            ].join("\n"),
        }, { quoted: msg })
        return true
    }

    if (!(context.canControlOwner || context.isOwner || msg?.key?.fromMe)) return true
    if (!capabilities.memberLabel) {
        await sock.sendMessage(access.groupJid, { text: "Member label native tidak tersedia pada versi/socket aktif." }, { quoted: msg })
        return true
    }
    const label = action === "clear" ? "" : sanitizeRole(action === "set" ? rest.join(" ") : [actionRaw, ...rest].join(" "))
    if (action !== "clear" && !label) {
        await sock.sendMessage(access.groupJid, { text: "Format: .memberlabel set <label>. Label admin/owner palsu ditolak." }, { quoted: msg })
        return true
    }
    await sock.updateMemberLabel(access.groupJid, label)
    await sock.sendMessage(access.groupJid, {
        text: label ? `Member label native akun sendiri diperbarui: ${label}` : "Member label native akun sendiri dibersihkan.",
    }, { quoted: msg })
    return true
}

async function handleGroupRoleCommand(sock, msg, context = {}) {
    const text = String(context.text || "").trim()
    const commandMatch = text.match(COMMAND_RE)
    if (!commandMatch) return false
    const command = commandMatch[1].toLowerCase()
    const argument = text.slice(commandMatch[0].length).trim()
    const metadata = context.runtimePolicy?.metadata
    const access = await common.resolveCommandAccess(sock, msg, "groupUtilities", context, metadata ? { metadata } : {})
    if (access.hardDenied) return true
    if (!access.allowed) {
        await sock.sendMessage(access.groupJid, { text: "Perintah role hanya untuk owner/admin grup." }, { quoted: msg })
        return true
    }
    if (command === "memberlabel") return handleMemberLabel(sock, msg, context, access, argument)

    const [actionRaw] = argument.split(/\s+/)
    const action = String(actionRaw || "status").toLowerCase()
    if (action === "list") {
        const entries = []
        const mentions = []
        for (const participant of access.policy.metadata?.participants || []) {
            const entry = getRole(access.groupJid, participantValues(participant), context)
            if (!entry?.role) continue
            const jid = common.getPreferredJid(participant, context)
            if (!jid) continue
            mentions.push(jid)
            entries.push(`@${groupRuntimePolicy.jidUser(jid)} — ${entry.role} (lokal)`)
        }
        await sock.sendMessage(access.groupJid, {
            text: entries.length ? `Role lokal grup:\n${entries.join("\n")}` : "Belum ada role lokal di grup ini.",
            mentions,
        }, { quoted: msg })
        return true
    }

    const target = findRoleTarget(access.policy.metadata, msg, context)
    if (!target) {
        await sock.sendMessage(access.groupJid, {
            text: "Reply/mention anggota. Format: .grouprole set <role> | clear | status | list",
        }, { quoted: msg })
        return true
    }
    if (action === "status") {
        const entry = getRole(access.groupJid, participantValues(target.participant), context)
        await sock.sendMessage(access.groupJid, {
            text: `Role lokal @${groupRuntimePolicy.jidUser(target.jid)}: ${entry?.role || "belum ada"}`,
            mentions: [target.jid],
        }, { quoted: msg })
        return true
    }
    if (action === "clear") {
        const removed = clearRole(access.groupJid, participantValues(target.participant), context)
        await sock.sendMessage(access.groupJid, {
            text: removed ? "Role lokal dihapus." : "Anggota tersebut tidak memiliki role lokal.",
        }, { quoted: msg })
        return true
    }
    if (action !== "set") {
        await sock.sendMessage(access.groupJid, { text: "Format: .grouprole set <role> | clear | status | list" }, { quoted: msg })
        return true
    }
    const role = sanitizeRole(argument.replace(/^set\b/i, ""))
    if (!role) {
        await sock.sendMessage(access.groupJid, { text: "Role kosong/tidak valid. Nama admin/owner palsu tidak diizinkan." }, { quoted: msg })
        return true
    }
    setRole(access.groupJid, participantValues(target.participant), role, context, access.senderJid)
    await sock.sendMessage(access.groupJid, {
        text: `Role lokal @${groupRuntimePolicy.jidUser(target.jid)} diset: ${role}`,
        mentions: [target.jid],
    }, { quoted: msg })
    return true
}

module.exports = {
    COMMAND_RE,
    DATA_FILE,
    clearRole,
    getGroupRoles,
    getRole,
    handleGroupRoleCommand,
    sanitizeRole,
    setRole,
    store,
}

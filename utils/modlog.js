/**
 * Structured moderation logging plus MongoDB case creation.
 * A moderation case is persisted even when no log channel is configured.
 */

const { EmbedBuilder } = require("discord.js")
const { createCase } = require("./moderationCases")

const ACTION_COLORS = {
    WARN: 0xFFAA00, CLEAR_WARNINGS: 0x99AABB, TIMEOUT: 0xFF6600, MUTE: 0xFF6600,
    UNTIMEOUT: 0x00CC88, UNMUTE: 0x00CC88, KICK: 0xFF4444, BAN: 0xCC0000,
    UNBAN: 0x00AA88, TEMPBAN: 0xCC5500, SOFTBAN: 0xCC7700, PURGE: 0x5865F2,
    LOCK: 0x9922CC, UNLOCK: 0x22AA88, SLOWMODE: 0x5865F2, NICKNAME: 0x3498DB,
    NOTE: 0x95A5A6, QUARANTINE: 0xE67E22, UNQUARANTINE: 0x2ECC71,
    LOCKDOWN_ENABLE: 0xC0392B, LOCKDOWN_DISABLE: 0x27AE60, ANTI_LINK: 0xAA44FF,
    ANTI_INVITE: 0xDD44AA, ANTI_SPAM: 0xFF8800,
}
const ACTION_EMOJIS = {
    WARN:"⚠️",CLEAR_WARNINGS:"🧹",TIMEOUT:"🔇",MUTE:"🔇",UNTIMEOUT:"🔊",UNMUTE:"🔊",
    KICK:"👢",BAN:"🔨",UNBAN:"🕊️",TEMPBAN:"⏳",SOFTBAN:"🧹",PURGE:"🧹",LOCK:"🔒",
    UNLOCK:"🔓",SLOWMODE:"🐢",NICKNAME:"🏷️",NOTE:"📝",QUARANTINE:"🛡️",UNQUARANTINE:"✅",
    LOCKDOWN_ENABLE:"🚨",LOCKDOWN_DISABLE:"🔓",ANTI_LINK:"🔗",ANTI_INVITE:"📨",ANTI_SPAM:"🚫",
}
let _client = null
function setClient(client) {
    _client = client
    try { require("./activityTracker").attachActivityTracking(client) } catch (err) { console.error("Activity tracking listener setup error:", err.message) }
    try { require("./moderationPhase2Bootstrap").initializeModerationPhase2(client) } catch (err) { console.error("Moderation Phase 2 setup error:", err.message) }
    try { require("./securityPhase3Bootstrap").initializeSecurityPhase3(client) } catch (err) { console.error("Moderation Phase 3 setup error:", err.message) }
    // Tickets are isolated behind their own guarded bootstrap. A ticket setup,
    // scheduler, component, or command failure cannot stop unrelated CURSED features.
    try { require("./ticketBootstrap").initializeTicketSystem(client) } catch (err) { console.error("Ticket System setup error:", err.message) }
}
function inferDurationMs(extra) { const text=String(extra||"");const m=text.match(/(\d+)\s*minute/i);if(m)return Number(m[1])*60000;const h=text.match(/(\d+)\s*hour/i);if(h)return Number(h[1])*3600000;const d=text.match(/(\d+)\s*day/i);if(d)return Number(d[1])*86400000;return null }
function isAutoAction(action, moderator, source) { return source === "automod" || (!moderator && String(action).startsWith("ANTI_")) }
async function logAction(guild,{action,target,moderator,reason,extra,durationMs=null,evidenceUrl=null,source=null,metadata={},createCaseRecord=true}) {
    const normalizedAction=String(action||"NOTE").toUpperCase(),resolvedSource=source||(isAutoAction(normalizedAction,moderator,source)?"automod":"manual")
    let caseRecord=null
    if(createCaseRecord&&guild?.id&&target?.id)caseRecord=await createCase({guildId:guild.id,action:normalizedAction,target,moderator,reason,durationMs:durationMs||inferDurationMs(extra),evidenceUrl,source:resolvedSource,metadata:{...(metadata&&typeof metadata==="object"?metadata:{}),details:extra||null}})
    if(!_client)return{caseRecord,logged:false}
    let channelId=null
    try{const{config}=require("./serverConfig").getServerConfig(guild.id);channelId=config.modLogChannelId||process.env.MOD_LOG_CHANNEL_ID||null}catch{channelId=process.env.MOD_LOG_CHANNEL_ID||null}
    if(!channelId)return{caseRecord,logged:false}
    const channel=guild.channels.cache.get(channelId);if(!channel||!channel.isTextBased())return{caseRecord,logged:false}
    const color=ACTION_COLORS[normalizedAction]??0x99AABB,emoji=ACTION_EMOJIS[normalizedAction]??"🛡️",label=normalizedAction.replace(/_/g," "),targetType=metadata?.targetType==="channel"?"channel":"user",targetDisplay=targetType==="channel"?`<#${target.id}> (${target.tag||"Unknown channel"})`:`<@${target.id}> (${target.tag||"Unknown"})`
    const embed=new EmbedBuilder().setColor(color).setTitle(`${emoji} ${label}`).addFields({name:targetType==="channel"?"📢 Channel":"👤 User",value:targetDisplay,inline:true},{name:"🆔 Target ID",value:String(target.id),inline:true}).setTimestamp()
    if(caseRecord)embed.addFields({name:"📁 Case",value:`#${caseRecord.caseNumber}`,inline:true})
    if(moderator)embed.addFields({name:"🛡️ Moderator",value:`<@${moderator.id}> (${moderator.tag||"Unknown"})`,inline:true});else embed.addFields({name:"🤖 Action by",value:"Auto-Moderation",inline:true})
    if(reason)embed.addFields({name:"📝 Reason",value:String(reason).slice(0,1024),inline:false})
    if(extra)embed.addFields({name:"ℹ️ Details",value:String(extra).slice(0,1024),inline:false})
    if(evidenceUrl)embed.addFields({name:"🔎 Evidence",value:String(evidenceUrl).slice(0,1024),inline:false})
    try{await channel.send({embeds:[embed],allowedMentions:{parse:[]}});return{caseRecord,logged:true}}catch(err){console.error("Mod-log send error:",err.message);return{caseRecord,logged:false}}
}
module.exports={setClient,logAction}

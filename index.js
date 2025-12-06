// ==================================================================
// 🌈 INAEV RAINBOW GOD MODE • ULTRA RGB TERMINAL ANIMATION 🌈
// ==================================================================


// ================= END CYBER WAVE =================
import fs from 'fs';
import axios from 'axios';
import { Telegraf } from 'telegraf';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import P from "pino";
import qrcode from 'qrcode';
import nodemailer from 'nodemailer';
import csv from 'csv-parser';
import XLSX from 'xlsx';
import { PassThrough } from 'stream';

// =========== AUTO UPDATE SIMPLE BY INAEV ===========
const VERSION_URL = "https://raw.githubusercontent.com/itsInaev/bot-update-inaev/main/version.json";
const SCRIPT_URL = "https://raw.githubusercontent.com/itsInaev/bot-update-inaev/main/index.js";

// current version (VERSI BUYER)
const CURRENT_VERSION = "1.0.0";

async function checkUpdate() {
  try {
    console.log("🔍 Mengecek update...");

    const { data } = await axios.get(VERSION_URL);
    const latestVersion = data.version;

    if (latestVersion !== CURRENT_VERSION) {
      console.log(`🚀 Update baru tersedia! Versi: ${latestVersion}`);

      const script = await axios.get(SCRIPT_URL);
      fs.writeFileSync("./index.js", script.data);

      console.log("📥 Script berhasil diupdate! Silakan restart bot secara MANUAL untuk menerapkan update.");
      return; // aman untuk hosting, tidak dianggap crash
    } else {
      console.log("👍 Bot sudah versi terbaru.");
    }
  } catch (e) {
    console.error("❌ Gagal cek update:", e.message);
  }
}

// cek setiap bot start + tiap 1 menit
checkUpdate();
setInterval(checkUpdate, 60000);
// =====================================================


// Import konfigurasi dari config.js
import {
  TELEGRAM_BOT_TOKEN,
  OWNER_ID,
  GROUP_LINK,
  VERIFICATION_GROUP_ID,
  WHATSAPP_EMAIL,
  EMAIL_SENDER,
  EMAIL_PASSWORD,
  COOLDOWN_DURATION,
  COOLDOWN_TIME,
  MAX_RECONNECT_ATTEMPTS,
  MT_FILE,
  PREMIUM_FILE,
  USER_DB,
  HISTORY_DB,
  BANNED_GROUP_DB,
  SETTINGS_DB,
  ALLOWED_FILE,
  ADMIN_FILE,
  RANDOM_NAMES,
  APPEAL_MESSAGES
} from './config.js';

// Inisialisasi bot Telegram
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Variabel untuk koneksi WhatsApp
let whatsappSock = null;
let isWhatsAppConnected = false;
let reconnectAttempts = 0;
let qrCodeString = '';

// Data storage
let allowedIds = [];
let adminIds = [];

// Cooldown system - GLOBAL 1000 DETIK
const userCooldowns = new Map();

// ========== FUNGSI UTILITAS ==========

function formatDate(ts) {
  const date = new Date(ts * 1000);

  const options = {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta"
  };

  return date
    .toLocaleString("id-ID", options)
    .replace(",", "")
    .replace(" ", " • ");
}

// Inisialisasi file database
function initDbFile(filePath, defaultData) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 4), 'utf8');
  }
}

// ================= setfoto =================
function getMenuPhoto() {
  const settings = readDb(SETTINGS_DB);
  return settings.menu_photo || PHOTO_FILE_ID; // fallback ke default
}

function setMenuPhoto(fileId) {
  const settings = readDb(SETTINGS_DB);
  settings.menu_photo = fileId;
  writeDb(SETTINGS_DB, settings);
}

// addowner
// Path file owner
// =================== OWNER SYSTEM (MAIN + EXTRA) ===================

// Path file owners
const OWNER_FILE = "./owners.json";

// Load owners
function loadOwners() {
  try {
    return JSON.parse(fs.readFileSync(OWNER_FILE));
  } catch (e) {
    // default kalau file belum ada
    return { 
      main: [OWNER_ID], 
      extra: [] 
    };
  }
}

// Simpan owners
function saveOwners(data) {
  fs.writeFileSync(OWNER_FILE, JSON.stringify(data, null, 2));
}

// Owner utama
function isMainOwner(userId) {
  return userId === OWNER_ID;
}

// Owner tambahan (punya masa aktif)
function isExtraOwner(userId) {
  const data = loadOwners();
  const now = Math.floor(Date.now() / 1000);

  // filter expired
  const valid = data.extra.filter(x => x.until > now);

  // kalau ada yang expired → update file
  if (valid.length !== data.extra.length) {
    data.extra = valid;
    saveOwners(data);
  }

  // cek apakah userId ada di extra valid
  return valid.some(x => x.id === userId);
}

// Owner final (utama + extra)
function isOwner(userId) {
  return isMainOwner(userId) || isExtraOwner(userId);
}

// Helper functions
function saveAllowed() {
  try {
    fs.writeFileSync(ALLOWED_FILE, JSON.stringify(allowedIds, null, 2), 'utf8');
  } catch (e) {
    console.error('❌ Gagal simpan allowed.json', e);
  }
}

function saveAdmin() {
  try {
    fs.writeFileSync(ADMIN_FILE, JSON.stringify(adminIds, null, 2), 'utf8');
  } catch (e) {
    console.error('❌ Gagal simpan admin.json', e);
  }
}

function isAdmin(userId) {
  return isOwner(userId) || adminIds.includes(userId);
}

function isAllowed(userId) {
  // Akses diperbolehkan untuk Owner / Admin / Premium saja
  return isAdmin(userId) || isPremium(userId);
}

function isPremium(userId) {
  // Owner and admin always bypass premium requirement
  if (isAdmin(userId)) return true;
  // Check PREMIUM_FILE list and user.status
  try {
    const premiumUsers = readDb(PREMIUM_FILE) || [];
    const user = getUser(userId);
    if (user && user.status === 'premium') return true;
    if (Array.isArray(premiumUsers) && premiumUsers.includes(userId)) return true;
  } catch (e) {
    // ignore read errors and treat as not premium
  }
  return false;
}


// Cooldown system - GLOBAL 1000 DETIK
function checkCooldown(userId) {
  // Sistem cooldown dimatkan total — user selalu diizinkan.
  return { allowed: true, remaining: 0 };
}

function getRandomName() {
  return RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
}

function getRandomAppealMessage(name, number) {
  const randomIndex = Math.floor(Math.random() * APPEAL_MESSAGES.length);
  return APPEAL_MESSAGES[randomIndex]
    .replace('(NAME)', name)
    .replace('+NUMBER', number);
}

// =========================== FORCE JOIN SYSTEM =============================
const CHANNEL_DB = 'required_channel.json';

// Load channel dari file
function loadRequiredChannel() {
  if (!fs.existsSync(CHANNEL_DB)) {
    fs.writeFileSync(
      CHANNEL_DB,
      JSON.stringify({ channel: "@inaevch" }, null, 2)
    );
  }
  return JSON.parse(fs.readFileSync(CHANNEL_DB, 'utf8')).channel;
}

// Simpan channel baru
function saveRequiredChannel(name) {
  fs.writeFileSync(
    CHANNEL_DB,
    JSON.stringify({ channel: name }, null, 2)
  );
}

// Variabel runtime (biar nggak perlu restart saat update)
let REQUIRED_CHANNEL = loadRequiredChannel();

// Cek apakah user sudah join channel
async function isUserInChannel(bot, userId) {
  const channel = loadRequiredChannel();
  try {
    const member = await bot.telegram.getChatMember(channel, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (e) {
    return false;
  }
}

// ======================= PER-COMMAND COOLDOWN SYSTEM =======================
const FEATURE_COOLDOWN_DB = 'feature_cooldown.json';

// Load default config
function loadFeatureCooldown() {
  if (!fs.existsSync(FEATURE_COOLDOWN_DB)) {
    fs.writeFileSync(
      FEATURE_COOLDOWN_DB,
      JSON.stringify({}, null, 2)
    );
  }
  return JSON.parse(fs.readFileSync(FEATURE_COOLDOWN_DB, 'utf8'));
}

function saveFeatureCooldown(data) {
  fs.writeFileSync(FEATURE_COOLDOWN_DB, JSON.stringify(data, null, 2));
}

// Cache time per user
const featureCooldownMap = new Map();

function checkFeatureCooldown(userId, featureName) {
  const cfg = loadFeatureCooldown();
  const cd = cfg[featureName] || 0; // default tidak ada cooldown

  if (cd === 0) {
    return { allowed: true, remaining: 0 };
  }

  const now = Date.now();
  const key = `${userId}_${featureName}`;

  const last = featureCooldownMap.get(key) || 0;

  if (now - last < cd * 1000) {
    const remaining = ((cd * 1000) - (now - last)) / 1000;
    return { allowed: false, remaining };
  }

  featureCooldownMap.set(key, now);
  return { allowed: true, remaining: 0 };
}

// ======================= MULTI SENDER STORAGE =======================
// nama file untuk menyimpan daftar sender
const SENDERS_DB = 'senders.json';

/**
 * Load semua sender dari file senders.json
 * return: array, contoh:
 * [
 *   { id: '628123@server', phone: '628123', status: 'connected', sessionPath: 'session-628123' }
 * ]
 */
function loadSenders() {
  try {
    const raw = fs.readFileSync(SENDERS_DB, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    // kalau file belum ada / error parse → balikin array kosong
    return [];
  }
}

/**
 * Simpan array sender ke senders.json
 */
function saveSenders(list) {
  try {
    fs.writeFileSync(SENDERS_DB, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.error('Gagal menyimpan senders.json:', e);
  }
}

/**
 * Cari sender berdasarkan nomor (misal '628123456789')
 */
function getSenderByNumber(phone) {
  const senders = loadSenders();
  return senders.find(s => s.phone === phone);
}

/**
 * Insert / update data sender
 * sender minimal: { id, phone }
 * bisa juga ditambah: { status, sessionPath, lastActive, ... }
 */
function upsertSender(sender) {
  const list = loadSenders();
  const idx = list.findIndex(s => s.id === sender.id);

  if (idx === -1) {
    list.push(sender);
  } else {
    list[idx] = { ...list[idx], ...sender };
  }

  saveSenders(list);
}

/**
 * Tandai sender disconnect / logged_out
 */
function markSenderDisconnected(id, reason = 'disconnected') {
  const list = loadSenders();
  const idx = list.findIndex(s => s.id === id);
  if (idx !== -1) {
    list[idx].status = reason;
    list[idx].lastDisconnected = Date.now();
    saveSenders(list);
  }
}

/**
 * Ambil semua sender yang statusnya 'connected'
 */
function getActiveSenders() {
  return loadSenders().filter(s => s.status === 'connected');
}

// Helper untuk cek nomor repe (nomor bagus)
function isRepeNumber(number) {
  const numStr = number.toString();
  if (/(\d)\1{2,}/.test(numStr)) return true;
  
  const digits = numStr.split('').map(Number);
  let sequentialUp = true;
  let sequentialDown = true;
  
  for (let i = 1; i < digits.length; i++) {
    if (digits[i] !== digits[i-1] + 1) sequentialUp = false;
    if (digits[i] !== digits[i-1] - 1) sequentialDown = false;
  }
  
  if (sequentialUp || sequentialDown) return true;
  if (numStr === numStr.split('').reverse().join('')) return true;
  
  if (numStr.length % 2 === 0) {
    const half = numStr.length / 2;
    if (numStr.slice(0, half) === numStr.slice(half)) return true;
  }
  
  return false;
}

// ======================================
//  PERSENTASE NOMOR (VERIF / CANTIK)
// ======================================
function getVerificationPercentage(number) {  
  const numStr = number.toString();  

  // kalau nomor repe, paling tinggi
  if (isRepeNumber(number)) return 99;  

  // 4 digit sama berurutan
  if (/(\d)\1{3,}/.test(numStr)) return 95;  

  // 3 digit sama berurutan
  if (/(\d)\1{2,}/.test(numStr)) return 90;  
    
  const digits = numStr.split('').map(Number);  
  let sequentialUp = true;  
  let sequentialDown = true;  
    
  for (let i = 1; i < digits.length; i++) {  
    if (digits[i] !== digits[i-1] + 1) sequentialUp = false;  
    if (digits[i] !== digits[i-1] - 1) sequentialDown = false;  
  }  
    
  if (sequentialUp || sequentialDown) return 85;  
    
  if (numStr.length >= 6) {  
    if (numStr.length % 2 === 0) {  
      const half = numStr.length / 2;  
      if (numStr.slice(0, half) === numStr.slice(half)) return 80;  
    }  
    if (/(\d)\1(\d)\2(\d)\3/.test(numStr)) return 75;  
  }  
    
  if (numStr.length >= 12) return 70;  
  if (numStr.length >= 10) return 60;  
  if (numStr.length >= 8) return 50;  
    
  return 40;  
}  

// ======================================
//  PERSENTASE "TIDAK NGEJAM" (JAM PERCENT)
// ======================================
function getJamPercentage(bio, setAt, metaBusiness) {  
  let basePercentage = 50;  
    
  // Faktor berdasarkan panjang bio  
  if (bio && bio.length > 0) {  
    if (bio.length > 100) basePercentage -= 20;  
    else if (bio.length > 50) basePercentage -= 15;  
    else if (bio.length > 20) basePercentage -= 10;  
    else basePercentage -= 5;  
  } else {  
    basePercentage += 15;  
  }  
    
  // Faktor berdasarkan usia bio  
  if (setAt) {  
    const now = new Date();  
    const bioDate = new Date(setAt);  
    const diffTime = Math.abs(now - bioDate);  
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));  
      
    if (diffDays < 30) basePercentage -= 20;  
    else if (diffDays < 90) basePercentage -= 10;  
    else if (diffDays > 365) basePercentage += 15;  
    else if (diffDays > 730) basePercentage += 25;  
  } else {  
    basePercentage += 10;  
  }  
    
  // Faktor Meta Business  
  if (metaBusiness) {  
    basePercentage -= 25;  
  }  
    
  // Pastikan dalam range 10-90%  
  basePercentage = Math.max(10, Math.min(90, basePercentage));  
    
  // Bulatkan ke kelipatan 10 terdekat  
  return Math.round(basePercentage / 10) * 10;  
}  

// ======================================
//  PROGRESS BAR (UNTUK PERSENTASE)
// ======================================
function createProgressBar(current, total = 100, length = 20) {  
  const percentage = current / total;  
  const filledLength = Math.round(length * percentage);  
  const emptyLength = length - filledLength;  
    
  const filledBar = '█'.repeat(filledLength);  
  const emptyBar = '░'.repeat(emptyLength);  
    
  return `[${filledBar}${emptyBar}]`;  
}  

// ========== FUNGSI BARU UNTUK CEK META BUSINESS ==========
async function checkMetaBusiness(jid) {  
  try {  
    const businessProfile = await whatsappSock.getBusinessProfile(jid);  
    if (businessProfile) {  
      return {  
        isBusiness: true,  
        businessData: businessProfile  
      };  
    }  
    return { isBusiness: false, businessData: null };  
  } catch (error) {  
    return { isBusiness: false, businessData: null };  
  }  
}  

// ======================================
//  FILE HASIL CEK BIO (LENGKAP)
// ======================================
function createBioResultFile(results, totalNumbers, sourceType = 'Input Manual') {  
  const timestamp = Date.now();  
  const filename = `cekbio_by_itsInaev_${timestamp}.txt`;  
    
  let fileContent = `HASIL CEK BIO SEMUA USER\n\n`;  
    
  const withBio = results.filter(r => r.registered && r.bio && r.bio.length > 0);  
  const withoutBio = results.filter(r => r.registered && (!r.bio || r.bio.length === 0));  
  const notRegistered = results.filter(r => !r.registered);  
  const metaBusinessCount = results.filter(r => r.metaBusiness).length;

  fileContent += `✅ Total nomor dicek : ${totalNumbers}\n`;  
  fileContent += `📳 Dengan Bio       : ${withBio.length}\n`;  
  fileContent += `📵 Tanpa Bio        : ${withoutBio.length}\n`;  
  fileContent += `🚫 Tidak Terdaftar  : ${notRegistered.length}\n`;  
  fileContent += `🏢 Meta Business    : ${metaBusinessCount}\n`;  
  fileContent += `📁 Sumber Data      : ${sourceType}\n\n`;  
  fileContent += '----------------------------------------\n\n';  
    
  // ========== NOMOR DENGAN BIO (GROUP BY TAHUN) ==========
  if (withBio.length > 0) {  
    fileContent += `✅ NOMOR YANG ADA BIO NYA (${withBio.length})\n\n`;  
      
    const groupedByYear = {};  
    withBio.forEach(result => {  
      if (result.setAt) {  
        const year = new Date(result.setAt).getFullYear();  
        if (!groupedByYear[year]) groupedByYear[year] = [];  
        groupedByYear[year].push(result);  
      } else {  
        if (!groupedByYear['Tidak Diketahui']) groupedByYear['Tidak Diketahui'] = [];  
        groupedByYear['Tidak Diketahui'].push(result);  
      }  
    });  
      
    const sortedYears = Object.keys(groupedByYear).sort((a, b) => {  
      if (a === 'Tidak Diketahui') return 1;  
      if (b === 'Tidak Diketahui') return -1;  
      return parseInt(a) - parseInt(b);  
    });  
      
    sortedYears.forEach(year => {  
      fileContent += `Tahun ${year}\n\n`;  
        
      groupedByYear[year].forEach((result) => {  
        const verifyPct = getVerificationPercentage(result.number);
        const jamPercentage = result.jamPercentage || getJamPercentage(result.bio, result.setAt, result.metaBusiness);
        const jamBar = createProgressBar(jamPercentage, 100);

        fileContent += `└─ 📅 ${result.number}\n`;  
        fileContent += `   └─ 📝 "${result.bio}"\n`;  
          
        if (result.setAt) {  
          const date = new Date(result.setAt);  
          const dateStr = date.toLocaleDateString('id-ID', {  
            day: '2-digit',  
            month: '2-digit',  
            year: 'numeric'  
          });  
          const timeStr = date.toLocaleTimeString('id-ID', {  
            hour: '2-digit',  
            minute: '2-digit',  
            second: '2-digit'  
          });  
          fileContent += `      └─ ⏰ ${dateStr}, ${timeStr}\n`;  
        }  
          
        if (result.metaBusiness) {  
          fileContent += `      └─ ✅ Nomor Ini Terdaftar Meta Business\n`;  
        } else {  
          fileContent += `      └─ ❌ Nomor Ini Tidak Ada Meta Businesses\n`;  
        }  

        fileContent += `      └─ 🎯 Kualitas Nomor : ${verifyPct}%\n`;
        fileContent += `      └─ 📮 ${jamPercentage}% Tidak Ngejam ${jamBar}\n`;  
        fileContent += '\n';  
      });  
    });  
      
    fileContent += '----------------------------------------\n\n';  
  }  
    
  // ========== NOMOR TANPA BIO / PRIVASI ==========
  if (withoutBio.length > 0) {  
    fileContent += `📵 NOMOR TANPA BIO / PRIVASI (${withoutBio.length})\n\n`;  
      
    withoutBio.forEach((result) => {  
      const verifyPct = getVerificationPercentage(result.number);
      const jamPercentage = result.jamPercentage || getJamPercentage(result.bio, result.setAt, result.metaBusiness);
      const jamBar = createProgressBar(jamPercentage, 100);

      fileContent += `${result.number}\n`;  
        
      if (result.metaBusiness) {  
        fileContent += `└─ ✅ Nomor Ini Terdaftar Meta Business\n`;  
      } else {  
        fileContent += `└─ ❌ Nomor Ini Tidak Ada Meta Businesses\n`;  
      }  

      fileContent += `└─ 🎯 Kualitas Nomor : ${verifyPct}%\n`;
      fileContent += `└─ 📮 ${jamPercentage}% Tidak Ngejam ${jamBar}\n`;  
      fileContent += '\n';  
    });  
      
    fileContent += '----------------------------------------\n\n';  
  }  
    
  // ========== NOMOR TIDAK TERDAFTAR ==========
  if (notRegistered.length > 0) {  
    fileContent += `🚫 NOMOR TIDAK TERDAFTAR (${notRegistered.length})\n\n`;  
      
    notRegistered.forEach((result) => {  
      const verifyPct = getVerificationPercentage(result.number);
      fileContent += `${result.number}  (🎯 ${verifyPct}%)\n`;  
    });  
  }  

  // FOOTER BRAND
  fileContent += '\n========================================\n';  
  fileContent += 'Generated by InaevBOT\n';  
  fileContent += 'by @itsInaev\n';  
    
  fs.writeFileSync(filename, fileContent, 'utf8');  
  return filename;  
}  

// ======================================
//  FILE HASIL CEK NOKOS REPE
// ======================================
function createRepeResultFile(registeredRepe, notRegisteredRepe, notRepeNumbers) {  
  const timestamp = Date.now();  
  const filename = `repe_by_itsInaev_${timestamp}.txt`;  
    
  let fileContent = `📚 Hasil cek repe\n\n`;  
    
  if (registeredRepe.length > 0) {  
    fileContent += `Nokos Repe yang terdaftar\n`;  
    registeredRepe.forEach((item, index) => {  
      const verifyPct = getVerificationPercentage(item.number);
      fileContent += `✅ ${index + 1}. ${item.number}  (🎯 ${verifyPct}%)\n`;  
    });  
    fileContent += '\n';  
  }  
    
  if (notRegisteredRepe.length > 0) {  
    fileContent += `Nokos Repe yang tidak terdaftar\n`;  
    notRegisteredRepe.forEach((number, index) => {  
      const verifyPct = getVerificationPercentage(number);
      fileContent += `❌ ${index + 1}. ${number}  (🎯 ${verifyPct}%)\n`;  
    });  
    fileContent += '\n';  
  }  
  
  if (notRepeNumbers.registered.length > 0) {  
    fileContent += `Nomor biasa yang terdaftar\n`;  
    notRepeNumbers.registered.forEach((number, index) => {  
      const verifyPct = getVerificationPercentage(number);
      fileContent += `📱 ${index + 1}. ${number}  (🎯 ${verifyPct}%)\n`;  
    });  
    fileContent += '\n';  
  }  
  
  if (notRepeNumbers.notRegistered.length > 0) {  
    fileContent += `Nomor biasa yang tidak terdaftar\n`;  
    notRepeNumbers.notRegistered.forEach((number, index) => {  
      const verifyPct = getVerificationPercentage(number);
      fileContent += `🚫 ${index + 1}. ${number}  (🎯 ${verifyPct}%)\n`;  
    });  
  }  
  
  fileContent += '\n\n========================================\n';  
  fileContent += 'Generated by InaevBOT\n';  
  fileContent += 'by @itsInaev\n';  
    
  fs.writeFileSync(filename, fileContent, 'utf8');  
  return filename;  
}

// ========== SISTEM EMAIL & MT ==========

// Inisialisasi semua file database
function initAllDb() {
  initDbFile(MT_FILE, []);
  initDbFile(PREMIUM_FILE, []);
  initDbFile(USER_DB, {});
  initDbFile(HISTORY_DB, []);
  initDbFile(BANNED_GROUP_DB, []);
  initDbFile('groups.json', {});
  initDbFile('owners.json', [OWNER_ID]);
  initDbFile('emails.json', []);
  initDbFile(SETTINGS_DB, {
    cooldown_duration: 60000,
    global_cooldown: 0,
    active_mt_id: 0,
    active_email_id: 0
  });
}

// Baca database
function readDb(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return {};
  }
}

// Tulis database
function writeDb(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 4), 'utf8');
}

// Dapatkan MT texts
function getMtTexts() {
  return readDb(MT_FILE);
}

// Dapatkan MT text by ID
function getMtTextById(id) {
  return getMtTexts().find(mt => mt.id === id);
}

// Dapatkan active MT
function getActiveMt() {
  const settings = readDb(SETTINGS_DB);
  const activeId = settings.active_mt_id;

  let active = null;

  if (activeId) {
    active = getMtTextById(activeId);
  }

  // fallback otomatis: pilih template pertama
  if (!active) {
    const list = loadMtTemplates();
    active = list[0] || null;
  }

  return active;
}

// Setup email transporter
function setupTransporter() {
  const settings = readDb(SETTINGS_DB);
  const emails = readDb('emails.json');
  
  let emailUser = EMAIL_SENDER;
  let emailPass = EMAIL_PASSWORD;
  
  if (settings.active_email_id !== 0) {
    const activeEmail = emails.find(e => e.id === settings.active_email_id);
    if (activeEmail) {
      emailUser = activeEmail.email;
      emailPass = activeEmail.app_pass;
    }
  }
  
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: emailUser,
      pass: emailPass
    },
    timeout: 30000,
    connectionTimeout: 30000,
    socketTimeout: 30000,
    tls: {
      rejectUnauthorized: false
    }
  });
}

// Dapatkan user data
function getUser(userId) {
  const users = readDb(USER_DB);
  const defaultUser = {
    id: userId,
    username: 'N/A',
    status: isOwner(userId) ? 'owner' : 'free',
    is_banned: 0,
    last_fix: 0,
    fix_limit: 10,
    referral_points: 0,
    referred_by: null,
    referred_users: []
  };
  return users[userId] ? { ...defaultUser, ...users[userId] } : defaultUser;
}

// Simpan user data
function saveUser(user) {
  const users = readDb(USER_DB);
  users[user.id] = user;
  writeDb(USER_DB, users);
}

// Simpan history
function saveHistory(data) {
  const history = readDb(HISTORY_DB);
  const newId = history.length > 0 ? history[history.length - 1].id + 1 : 1;
  history.push({ id: newId, ...data, timestamp: new Date().toISOString() });
  writeDb(HISTORY_DB, history);
}

// ========== KONEKSI WHATSAPP DENGAN QR CODE & PAIRING ==========

async function startWhatsApp() {
  try {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.log('❌ Gagal reconnect WhatsApp setelah beberapa percobaan. Silakan restart bot.');
      return;
    }

    reconnectAttempts++;

    if (reconnectAttempts > 1) {
      console.log(`🔄 Mencoba reconnect WhatsApp... (Percobaan ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    }

    console.log('🔄 Menghubungkan ke WhatsApp...');

    // auth tunggal (nanti kalau mau multi-session, ini bisa dikasih parameter)
    const { state, saveCreds } = await useMultiFileAuthState('auth');
    const { version } = await fetchLatestBaileysVersion();

    whatsappSock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
      logger: P({ level: 'silent' }),
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
      generateHighQualityLinkPreview: true,
    });

    // simpan creds kalau berubah
    whatsappSock.ev.on('creds.update', saveCreds);

    // UPDATE STATUS KONEKSI + QR
    whatsappSock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCodeString = qr;
        console.log('📱 QR Code diterima, tunggu perintah /getqr untuk mengirim...');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log('❌ Koneksi WhatsApp terputus:', lastDisconnect?.error);

        // tandai sender di file sebagai disconnect
        if (whatsappSock?.user?.id) {
          const waId = whatsappSock.user.id;
          markSenderDisconnected(
            waId,
            shouldReconnect ? 'disconnected' : 'logged_out'
          );
        }

        if (shouldReconnect) {
          console.log('🔄 WhatsApp terputus, menghubungkan ulang...');
          isWhatsAppConnected = false;
          setTimeout(() => startWhatsApp(), 5000);
        } else {
          console.log('❌ WhatsApp logged out, perlu scan QR code baru.');
          isWhatsAppConnected = false;

          // hapus auth lama
          if (fs.existsSync('./auth')) {
            fs.rmSync('./auth', { recursive: true });
          }

          setTimeout(() => startWhatsApp(), 3000);
        }
      } else if (connection === 'open') {
        isWhatsAppConnected = true;
        reconnectAttempts = 0;
        qrCodeString = '';

        const waId = whatsappSock.user.id;          // contoh: 628xxxx:16@s.whatsapp.net
        const phoneNumber = waId.split(':')[0] || waId;

        console.log(`✅ WhatsApp terhubung sebagai ${waId}`);

        // SIMPAN / UPDATE SENDER DI senders.json
        upsertSender({
          id: waId,
          phone: phoneNumber,
          status: 'connected',
          lastConnected: Date.now(),
        });

        // Kirim notifikasi ke owner
        try {
          await bot.telegram.sendMessage(
            OWNER_ID,
            '✅ *WhatsApp Berhasil Terhubung!*\n\n' +
              `📱 *User ID:* \`${waId}\`\n` +
              `📞 *Nomor :* ${phoneNumber}\n` +
              `👤 *Nama  :* ${whatsappSock.user.name || 'Tidak ada nama'}\n` +
              '🔗 *Status:* Connected\n\n' +
              'Bot siap digunakan!\n' +
              '_Sender sudah disimpan di senders.json_',
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          console.error('Gagal kirim notifikasi ke owner:', error);
        }
      }
    });

    // HANDLE PESAN MASUK (kalau mau dipakai)
    whatsappSock.ev.on('messages.upsert', async (m) => {
      if (m.type === 'notify') {
        for (const msg of m.messages) {
          console.log('Pesan masuk dari WhatsApp:', msg.key.remoteJid);
          // di sini nanti bisa ditambah handler kalau perlu
        }
      }
    });

  } catch (error) {
    console.error('❌ Error saat menghubungkan WhatsApp:', error);
    isWhatsAppConnected = false;
    setTimeout(() => startWhatsApp(), 10000);
  }
}

// ========== FUNGSI UNTUK MEMBACA BERBAGAI JENIS FILE ==========

// Fungsi untuk membaca file TXT
async function readTxtFile(fileBuffer) {
  const content = fileBuffer.toString('utf8');
  return content.split(/[\r\n]+/).filter(num => num.trim().length > 0);
}

// Fungsi untuk membaca file CSV
async function readCsvFile(fileBuffer) {
  return new Promise((resolve, reject) => {
    const numbers = [];
    const bufferStream = new PassThrough();
    bufferStream.end(fileBuffer);
    
    bufferStream
      .pipe(csv())
      .on('data', (row) => {
        // Ambil semua nilai dari row dan cari nomor
        Object.values(row).forEach(value => {
          if (value && value.toString().trim().length > 0) {
            numbers.push(value.toString().trim());
          }
        });
      })
      .on('end', () => {
        resolve(numbers);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

// Fungsi untuk membaca file XLSX
async function readXlsxFile(fileBuffer) {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const numbers = [];
  
  // Loop melalui semua sheet
  workbook.SheetNames.forEach(sheetName => {
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    // Flatten array dan ambil semua nilai
    data.flat().forEach(value => {
      if (value && value.toString().trim().length > 0) {
        numbers.push(value.toString().trim());
      }
    });
  });
  
  return numbers;
}

// Fungsi untuk memproses file berdasarkan tipe
async function processFile(fileBuffer, fileName) {
  const fileExtension = fileName.toLowerCase().split('.').pop();
  
  switch (fileExtension) {
    case 'txt':
      return await readTxtFile(fileBuffer);
    case 'csv':
      return await readCsvFile(fileBuffer);
    case 'xlsx':
      return await readXlsxFile(fileBuffer);
    default:
      throw new Error(`Format file ${fileExtension} tidak didukung. Gunakan file TXT, CSV, atau XLSX.`);
  }
}

// Fungsi untuk mendapatkan source file type
function getFileSourceType(fileName) {
  const ext = fileName.toLowerCase().split('.').pop();
  switch (ext) {
    case 'txt': return 'File TXT';
    case 'csv': return 'File CSV';
    case 'xlsx': return 'File XLSX';
    default: return 'File';
  }
}

// ======================= USER HELPERS (GLOBALMSG) =======================

const USERS_DB = 'users.json'; // GANTI kalau nama file user kamu beda

function loadAllUsers() {
  try {
    const raw = fs.readFileSync(USERS_DB, 'utf8');
    const data = JSON.parse(raw);
    // kalau array → pakai langsung, kalau object map → ambil Object.values
    if (Array.isArray(data)) return data;
    if (typeof data === 'object' && data !== null) return Object.values(data);
    return [];
  } catch (e) {
    console.error('Gagal load users.json:', e.message);
    return [];
  }
}

// ======================= PREMIUM HELPERS =======================

const PREMIUM_DB = 'premium_users.json';

function loadPremiumUsers() {
  try {
    const raw = fs.readFileSync(PREMIUM_DB, 'utf8');
    const data = JSON.parse(raw);

    const arr = Array.isArray(data) ? data : [];

    // Normalisasi:
    // - kalau entry = number  -> { id: number, premium_until: null }
    // - kalau entry = object  -> pakai field id & premium_until
    return arr
      .map((entry) => {
        if (typeof entry === 'number') {
          return { id: entry, premium_until: null };
        }
        if (typeof entry === 'object' && entry !== null) {
          const id = entry.id ?? entry.userId ?? entry.uid;
          const premium_until =
            entry.premium_until !== undefined ? entry.premium_until : null;
          if (!id) return null;
          return { id, premium_until };
        }
        return null;
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

function savePremiumUsers(list) {
  try {
    fs.writeFileSync(PREMIUM_DB, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.error('Gagal menyimpan premium_users.json:', e);
  }
}

function upsertPremiumUser(userId, days) {
  const list = loadPremiumUsers();
  const now = Date.now();
  const oneDayMs = 86400000;
  const premiumUntil = now + days * oneDayMs;

  const idx = list.findIndex((u) => u.id === userId);
  if (idx >= 0) {
    list[idx].premium_until = premiumUntil;
  } else {
    list.push({ id: userId, premium_until: premiumUntil });
  }

  savePremiumUsers(list);
  return premiumUntil;
}

function removePremiumUser(userId) {
  const list = loadPremiumUsers();
  const filtered = list.filter((u) => u.id !== userId);
  savePremiumUsers(filtered);
  return list.length !== filtered.length;
}

function getPremiumInfo(userId) {
  const list = loadPremiumUsers();
  return list.find((u) => u.id === userId) || null;
}

// ======================= NOTIF PREMIUM H-1 =======================

// 1 hari dalam milidetik
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// Interval cek (misal: 1 jam sekali)
const PREMIUM_CHECK_INTERVAL_MS = 60 * 60 * 1000;

async function checkPremiumExpiringSoon() {
  try {
    const premiumList = loadPremiumUsers(); // pakai helper yang sudah ada
    const now = Date.now();

    if (!Array.isArray(premiumList) || !premiumList.length) {
      return; // tidak ada data premium
    }

    for (const u of premiumList) {
      const userId = u.id;
      if (!userId) continue;

      const ts = Number(u.premium_until);
      const d = new Date(ts);
      const valid =
        ts &&
        !Number.isNaN(ts) &&
        !Number.isNaN(d.getTime());

      // Kalau tidak ada tanggal expired (legacy premium lama) → skip dulu
      if (!valid) continue;

      const msLeft = ts - now;

      // Sudah lewat → skip, nanti bisa diproses di fitur auto-expired
      if (msLeft <= 0) continue;

      // Kalau masih lebih dari 1 hari → belum waktunya notif
      if (msLeft > ONE_DAY_MS) continue;

      // Ambil data user dari sistem utama
      const user = getUser(userId);

      // Jika bukan premium / sudah pernah dikasih notif → skip
      if (!user || user.status !== 'premium') continue;
      if (user.notified_expired) continue;

      // =======================
      // KIRIM NOTIF KE USER
      // =======================
      const expireStr = d.toISOString().replace('T', ' ').substring(0, 19);

      const msg =
        `⏳ *Pemberitahuan Premium*\n\n` +
        `Hi, premium kamu akan berakhir kurang dari *1 hari* lagi.\n\n` +
        `📆 Expired: \`${expireStr} (UTC)\`\n\n` +
        `Silakan perpanjang ke @itsInaev jika masih ingin menggunakan fitur premium.`;

      try {
        await bot.telegram.sendMessage(userId, msg, {
          parse_mode: 'Markdown'
        });

        // Tandai kalau user ini sudah dikasih notif, biar nggak di-spam
        user.notified_expired = true;
        saveUser(user);

        console.log(`Notif H-1 premium dikirim ke ${userId}`);
      } catch (e) {
        console.error(`Gagal kirim notif premium ke ${userId}:`, e.message);
      }
    }
  } catch (err) {
    console.error('Error saat cek premium H-1:', err);
  }
}

// Jalankan pengecekan berkala
setInterval(() => {
  checkPremiumExpiringSoon().catch((e) =>
    console.error('checkPremiumExpiringSoon error:', e)
  );
}, PREMIUM_CHECK_INTERVAL_MS);

// Fungsi untuk download file dari Telegram
async function downloadTelegramFile(fileId, fileName) {
  try {
    // Dapatkan file path dari Telegram
    const fileLink = await bot.telegram.getFileLink(fileId);
    
    // Download file menggunakan axios
    const response = await axios({
      method: 'GET',
      url: fileLink.href,
      responseType: 'arraybuffer'
    });
    
    return Buffer.from(response.data);
  } catch (error) {
    console.error('Error downloading file:', error);
    throw new Error(`Gagal mengunduh file: ${error.message}`);
  }
}

// ========== COMMAND TELEGRAM BOT ==========

// Command untuk mendapatkan QR Code WhatsApp
bot.command('getqr', async (ctx) => {
  const userId = ctx.message.from.id;
  
  if (!isOwner(userId)) {
    return ctx.reply('❌ Hanya owner yang bisa mendapatkan QR Code.');
  }

  if (isWhatsAppConnected) {
    return ctx.reply('✅ WhatsApp sudah terhubung. Tidak perlu QR Code.');
  }

  if (!qrCodeString) {
    return ctx.reply('❌ QR Code belum tersedia. Tunggu beberapa saat atau restart bot.');
  }

  try {
    const qrImage = await qrcode.toBuffer(qrCodeString, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    await ctx.replyWithPhoto({ source: qrImage }, {
      caption: '📱 *SCAN QR CODE INI UNTUK MENGHUBUNGKAN WHATSAPP*\n\n' +
               '1. Buka WhatsApp di ponsel Anda\n' +
               '2. Ketuk menu ⋯ > Perangkat tertaut > Tautkan Perangkat\n' +
               '3. Arahkan kamera ke QR code ini\n\n' +
               'QR Code akan berubah setiap 30 detik',
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Error generate QR code:', error);
    await ctx.reply('❌ Gagal generate QR Code. Coba lagi.');
  }
});

// Command untuk mendapatkan Pairing Code
bot.command('getpairing', async (ctx) => {
  const userId = ctx.message.from.id;
  
  if (!isPremium(userId)) {
    return ctx.reply('❌ Hanya owner/premium yang bisa mendapatkan pairing code.');
  }

  if (isWhatsAppConnected) {
    return ctx.reply('✅ WhatsApp sudah terhubung. Tidak perlu pairing code.');
  }

  if (!whatsappSock) {
    return ctx.reply('❌ WhatsApp belum siap. Tunggu beberapa saat.');
  }

  try {
    const phoneNumber = ctx.message.text.split(' ')[1];
    if (!phoneNumber) {
      return ctx.reply('❌ Format: /getpairing <nomor_whatsapp>\n\nContoh: /getpairing 628123456789');
    }

    const code = await whatsappSock.requestPairingCode(phoneNumber);
    const formattedCode = code.match(/.{1,4}/g)?.join('-') || code;
    
    await ctx.reply(
      `📱 *PAIRING CODE WHATSAPP*\n\n` +
      `📞 Nomor: ${phoneNumber}\n` +
      `🔢 Kode: ${formattedCode}\n\n` +
      `*Cara menggunakan:*\n` +
      `1. Buka WhatsApp di ponsel Anda\n` +
      `2. Masuk ke Settings > Linked Devices > Link a Device\n` +
      `3. Pilih "Link with Phone Number"\n` +
      `4. Masukkan kode di atas\n\n` +
      `⚠️ Kode ini berlaku terbatas, segera gunakan!`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error mendapatkan pairing code:', error);
        await ctx.reply('❌ Gagal mendapatkan pairing code. Pastikan nomor valid dan coba lagi.\n\nJika kamu Owner/Admin dan ingin menghubungkan sender baru, kamu WAJIB melakukan:\nrestartpanel\n\nSetelah panel berhasil direstart, ulangi proses pairing dengan perintah:\n/getpairing <nomor_whatsapp>\n\nContoh:\n/getpairing 628123456789`');
  }
});

// Command untuk status WhatsApp
bot.command('wastatus', async (ctx) => {
  const userId = ctx.message.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply('❌ Hanya admin yang bisa mengecek status WhatsApp.');
  }

  let statusMessage = `📱 *STATUS WHATSAPP BOT*\n\n`;
  
  if (isWhatsAppConnected && whatsappSock) {
    statusMessage += `✅ *Status:* Terhubung\n`;
    statusMessage += `📞 *Nomor:* ${whatsappSock.user?.id || 'Tidak diketahui'}\n`;
    statusMessage += `👤 *Nama:* ${whatsappSock.user?.name || 'Tidak ada nama'}\n`;
    statusMessage += `🕒 *Reconnect Attempts:* ${reconnectAttempts}\n`;
  } else if (qrCodeString) {
    statusMessage += `📱 *Status:* Menunggu Scan QR Code\n`;
    statusMessage += `🔗 *QR Code:* Tersedia (gunakan /getqr)\n`;
    statusMessage += `🕒 *Reconnect Attempts:* ${reconnectAttempts}\n`;
  } else {
    statusMessage += `❌ *Status:* Tidak Terhubung\n`;
    statusMessage += `🔧 *Status Koneksi:* Menghubungkan...\n`;
    statusMessage += `🕒 *Reconnect Attempts:* ${reconnectAttempts}\n`;
  }
  
  statusMessage += `\nTerakhir diperbarui: ${new Date().toLocaleString('id-ID')}`;

  await ctx.reply(statusMessage, { parse_mode: 'Markdown' });
});

// ========== COMMAND /FIX ==========

bot.command('fix', async (ctx) => {
  const userId = ctx.message.from.id;
  const chatId = ctx.message.chat.id;
  const username = ctx.message.from.username || ctx.message.from.first_name;

  // ========== CEK COOLDOWN ==========
  const cd = checkFeatureCooldown(userId, 'fix');
  if (!cd.allowed) {
    return ctx.reply(`⏳ Tunggu ${cd.remaining.toFixed(1)} detik sebelum menggunakan /fix lagi.`);
  }

  // ========== AKSES: Owner / Admin / Premium ==========
  if (!isAllowed(userId)) {
    return ctx.reply(
      '❌ Hanya Owner / Admin / Premium yang dapat menggunakan perintah ini.',
      { parse_mode: 'Markdown' }
    );
  }

  // ========== AMBIL ARGUMENT / NOMOR ==========
  const messageText = ctx.message.text;
  const args = messageText.replace('/fix', '').trim().split(/\s+/);

  if (args.length === 0 || !args[0]) {
    return ctx.reply(
  "❌ *Format penggunaan:*\n" +
  "`/fix nomor_whatsapp`\n\n" +
  "*Contoh:*\n" +
  "`/fix 628123456789`",
  { parse_mode: "Markdown" }
);
  }

  // ========== FORMAT NOMOR ==========
  let number = args[0].replace(/[^0-9+]/g, '');

  if (number.startsWith('0')) {
    number = '62' + number.substring(1);
  } else if (number.startsWith('8')) {
    number = '62' + number;
  }

  if (number.length < 10 || number.length > 15) {
    return ctx.reply('❌ Format nomor tidak valid.');
  }

  // ========== AMBIL DATA USER ==========
  const user = getUser(userId);

  // ========== TEMPLATE MT ==========
  const activeTemplate = getActiveMt();
  if (!activeTemplate) {
    return ctx.reply('❌ Tidak ada template banding yang aktif. Silakan hubungi developer.');
  }

  try {
    const transporter = setupTransporter();
    const body = activeTemplate.body.replace(/{number}/g, number);

    // ========== KIRIM EMAIL ==========
    await transporter.sendMail({
      from: transporter.options.auth.user,
      to: activeTemplate.to_email,
      subject: activeTemplate.subject,
      text: body
    });

    // ========== SIMPAN HISTORY ==========
    saveHistory({
      user_id: userId,
      username: username,
      command: `/fix ${number}`,
      number_fixed: number.replace('+', ''),
      email_used: transporter.options.auth.user,
      details: `Perintah FIX oleh user allowed (owner/admin/premium) - Template ID ${activeTemplate.id}`
    });

    await ctx.reply(
      `✅ Nomor *${number}* berhasil dibandinkan!\n\n` +
      `*Template:* ${activeTemplate.subject}\n` +
      `*Email:* ${transporter.options.auth.user}\n\n` +
      `Balasan dari WhatsApp akan otomatis dikirim ke chat ini.`,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error('Error mengirim email:', error);

    await ctx.reply(
      `❌ Gagal mengirim banding untuk nomor *${number}*:\n\`${error.message}\``,
      { parse_mode: 'Markdown' }
    );

    saveHistory({
      user_id: userId,
      username: username,
      command: `/fix ${number}`,
      number_fixed: number.replace('+', ''),
      email_used: 'Gagal',
      details: `Gagal mengirim banding: ${error.message}`
    });
  }
});

// ========== COMMAND MT MANAGEMENT ==========

bot.command('setmt', async (ctx) => {
  const userId = ctx.message.from.id;
  
  if (!isOwner(userId)) {
    return ctx.reply('❌ Hanya owner yang bisa mengatur MT.');
  }

  const messageText = ctx.message.text;
  const parts = messageText.replace('/setmt', '').trim().split('|').map(p => p.trim());

  if (parts.length < 3) {
    return ctx.reply('❌ Format: /setmt <email_tujuan> | <subjek> | <isi_pesan>');
  }

  const [to_email, subject, body] = parts;

  if (!body.includes('{nomor}')) {
    return ctx.reply('❌ Isi pesan wajib mengandung `{nomor}` untuk placeholder nomor WhatsApp.');
  }

  const mtTexts = getMtTexts();
  const newId = mtTexts.length > 0 ? mtTexts[mtTexts.length - 1].id + 1 : 1;

  mtTexts.push({ id: newId, to_email, subject, body });
  writeDb(MT_FILE, mtTexts);
    
  await ctx.reply(`✅ MT ID **${newId}** berhasil ditambahkan.\nSubjek: ${subject}\nEmail Tujuan: ${to_email}`);
});

bot.command('setactivemt', async (ctx) => {
  const userId = ctx.message.from.id;
  
  if (!isOwner(userId)) {
    return ctx.reply('❌ Hanya owner yang bisa mengatur MT aktif.');
  }

  const args = ctx.message.text.split(' ').slice(1);
  if (args.length === 0) {
    return ctx.reply('❌ Format: /setactivemt <id_mt>');
  }

  const id = parseInt(args[0]);
  const mtText = getMtTextById(id);

  if (!mtText) {
    return ctx.reply(`❌ MT ID ${id} tidak ditemukan.`);
  }

  const settings = readDb(SETTINGS_DB);
  settings.active_mt_id = id;
  writeDb(SETTINGS_DB, settings);

  await ctx.reply(`✅ Template banding aktif disetel ke **ID ${id}** (Subjek: ${mtText.subject})`);
});

bot.command('listmt', async (ctx) => {
  const userId = ctx.message.from.id;
  
  if (!isOwner(userId)) {
    return ctx.reply('❌ Hanya owner yang bisa melihat daftar MT.');
  }

  const mtTexts = getMtTexts();
  const settings = readDb(SETTINGS_DB);
  const activeId = settings.active_mt_id;

  if (mtTexts.length === 0) {
    return ctx.reply('📋 Tidak ada template banding yang tersedia.');
  }

  let text = `📋 Daftar Template Banding:\n\n`;
  mtTexts.forEach(mt => {
    text += `ID: ${mt.id} ${mt.id === activeId ? '✅' : ''}\n`;
    text += `Subjek: ${mt.subject}\n`;
    text += `Email: ${mt.to_email}\n`;
    text += `---\n`;
  });

  await ctx.reply(text);
});

// ========== COMMAND USER MANAGEMENT ==========

bot.command('addpremium', async (ctx) => {
  const executorId = ctx.message.from.id;

  // Hanya Admin & Owner
  if (!isOwner(executorId) && !isAdmin(executorId)) {
    return ctx.reply('❌ Hanya owner atau admin yang bisa menambah premium user.');
  }

  let targetId;

  // 1️⃣ Jika REPLY user
  if (ctx.message.reply_to_message) {
    targetId = ctx.message.reply_to_message.from.id;
  }

  // 2️⃣ Jika TAG user (@username)
  else if (ctx.message.entities && ctx.message.entities[1]?.user) {
    targetId = ctx.message.entities[1].user.id;
  }

  // 3️⃣ Jika /addpremium <id>
  else {
    const args = ctx.message.text.split(" ").slice(1);
    if (args.length === 0) {
      return ctx.reply('❌ Format: /addpremium <id_telegram> atau reply usernya.');
    }
    targetId = parseInt(args[0]);
  }

  if (!targetId || isNaN(targetId)) {
    return ctx.reply('❌ Tidak bisa mendeteksi ID user.');
  }

  // Load DB premium
  const premiumUsers = readDb(PREMIUM_FILE);

  if (premiumUsers.includes(targetId)) {
    return ctx.reply(`ℹ️ User ${targetId} sudah premium.`);
  }

  // Simpan ke DB
  premiumUsers.push(targetId);
  writeDb(PREMIUM_FILE, premiumUsers);

  // Update data user
  const user = getUser(targetId);
  user.status = "premium";
  saveUser(user);

  // Notifikasi sukses
  return ctx.reply(`✅ User ${targetId} berhasil dijadikan *Premium User*.`, {
    parse_mode: "Markdown"
  });
});

// ======================= /setpremium =======================

bot.command("setpremium", async (ctx) => {
  const executorId = ctx.message.from.id;

  // Hanya Owner & Admin
  if (!isOwner(executorId) && !isAdmin(executorId)) {
    return ctx.reply("❌ Hanya *Owner/Admin* yang dapat menggunakan perintah ini.", {
      parse_mode: "Markdown"
    });
  }

  const text = ctx.message.text.split(" ");
  let targetId = null;
  let days = null;

  // ==================================================
  // 1️⃣ MODE REPLY — /setpremium <hari>
  // ==================================================
  if (ctx.message.reply_to_message) {
    targetId = ctx.message.reply_to_message.from.id;

    if (!text[1] || isNaN(parseInt(text[1]))) {
      return ctx.reply("❌ Format: `/setpremium <hari>` jika menggunakan reply.", {
        parse_mode: "Markdown"
      });
    }

    days = parseInt(text[1]);
  }

  // ==================================================
  // 2️⃣ MODE MENTION — /setpremium @user <hari>
  // ==================================================
  else if (ctx.message.entities && ctx.message.entities[1]?.user) {
    const mentioned = ctx.message.entities[1].user;
    targetId = mentioned.id;

    if (!text[text.length - 1] || isNaN(parseInt(text[text.length - 1]))) {
      return ctx.reply("❌ Gunakan: `/setpremium @user <hari>`", { parse_mode: "Markdown" });
    }

    days = parseInt(text[text.length - 1]);
  }

  // ==================================================
  // 3️⃣ MODE MANUAL — /setpremium <id> <hari>
  // ==================================================
  else {
    if (text.length < 3) {
      return ctx.reply(
        "❌ Format salah.\n\n" +
        "Gunakan:\n" +
        "`/setpremium <id_telegram> <hari>`\n" +
        "Contoh:\n" +
        "`/setpremium 6407650863 1`\n" +
        "`/setpremium @user 30`\n" +
        "`(Reply pesan user) → /setpremium 7`",
        { parse_mode: "Markdown" }
      );
    }

    targetId = parseInt(text[1]);
    days = parseInt(text[2]);

    if (isNaN(targetId)) {
      return ctx.reply("❌ ID Telegram tidak valid.", { parse_mode: "Markdown" });
    }
  }

  // Validasi hari
  if (!days || isNaN(days) || days <= 0) {
    return ctx.reply("❌ Jumlah hari tidak valid.", { parse_mode: "Markdown" });
  }

  // ==================================================
  // 🔥 PROSES SET PREMIUM
  // ==================================================

  const user = getUser(targetId);
  user.status = "premium";
  user.notified_expired = false;

  const premiumUntil = upsertPremiumUser(targetId, days);
  user.premium_until = premiumUntil;
  saveUser(user);

  const expireDate = new Date(premiumUntil);
  const expireStr = expireDate.toISOString().replace("T", " ").substring(0, 19);

  return ctx.reply(
    `🎉 *PREMIUM INAEV DISET!*\n\n` +
    `👤 User : \`${targetId}\`\n` +
    `💎 Durasi : *${days} hari*\n` +
    `⏱ Expired: \`${expireStr} UTC\`\n\n` +
    `User sekarang *Premium*. 🚀`,
    { parse_mode: "Markdown" }
  );
});

// ======================= /delpremium =======================

bot.command("delpremium", async (ctx) => {
  const executorId = ctx.message.from.id;

  // Hanya owner & admin
  if (!isOwner(executorId) && !isAdmin(executorId)) {
    return ctx.reply("❌ Hanya owner atau admin yang bisa menghapus premium user.");
  }

  let targetId;

  // 1️⃣ Jika REPLY user
  if (ctx.message.reply_to_message) {
    targetId = ctx.message.reply_to_message.from.id;
  }

  // 2️⃣ Jika TAG username (@username)
  else if (ctx.message.entities && ctx.message.entities[1]?.user) {
    targetId = ctx.message.entities[1].user.id;
  }

  // 3️⃣ Jika /delpremium <id>
  else {
    const args = ctx.message.text.split(" ").slice(1);
    if (args.length === 0) {
      return ctx.reply(
        "❌ Format salah.\n\n" +
        "Gunakan:\n" +
        "`/delpremium <id_telegram>` atau reply usernya.",
        { parse_mode: "Markdown" }
      );
    }
    targetId = parseInt(args[0]);
  }

  if (!targetId || isNaN(targetId)) {
    return ctx.reply("❌ Tidak bisa mendeteksi ID user.", {
      parse_mode: "Markdown"
    });
  }

  // Load database premium
  const premiumUsers = readDb(PREMIUM_FILE);

  // Cek jika tidak premium
  if (!premiumUsers.includes(targetId)) {
    return ctx.reply(
      `ℹ️ User \`${targetId}\` tidak terdaftar sebagai premium.`,
      { parse_mode: "Markdown" }
    );
  }

  // Hapus dari DB
  const updated = premiumUsers.filter(id => id !== targetId);
  writeDb(PREMIUM_FILE, updated);

  // Update user data
  const user = getUser(targetId);
  user.status = "free";
  user.premium_until = null;
  user.notified_expired = false;
  saveUser(user);

  // Notifikasi sukses
  return ctx.reply(
    `✅ Premium untuk user \`${targetId}\` telah dicabut.`,
    { parse_mode: "Markdown" }
  );
});

// ======================= /cekpremium =======================

bot.command("cekpremium", async (ctx) => {
  const requesterId = ctx.message.from.id;
  let targetId = requesterId; // default cek diri sendiri

  // 1️⃣ Jika REPLY user
  if (ctx.message.reply_to_message) {
    targetId = ctx.message.reply_to_message.from.id;

    if (targetId !== requesterId && !isOwner(requesterId)) {
      return ctx.reply("❌ Kamu tidak punya izin mengecek premium user lain.");
    }
  }

  // 2️⃣ Jika mention username (@user)
  else if (ctx.message.entities && ctx.message.entities[1]?.user) {
    targetId = ctx.message.entities[1].user.id;

    if (targetId !== requesterId && !isOwner(requesterId)) {
      return ctx.reply("❌ Hanya owner yang bisa cek premium user lain.");
    }
  }

  // 3️⃣ Jika /cekpremium <id>
  else {
    const args = ctx.message.text.split(" ").slice(1);
    if (args.length >= 1) {
      if (!isOwner(requesterId)) {
        return ctx.reply("❌ Kamu tidak punya izin cek user lain.");
      }

      const parsed = parseInt(args[0]);
      if (!parsed || isNaN(parsed)) {
        return ctx.reply("❌ ID tidak valid.");
      }

      targetId = parsed;
    }
  }

  // Ambil info user
  const info = getPremiumInfo(targetId);
  const user = getUser(targetId);

  if (!info) {
    return ctx.reply(
      `📛 *STATUS PREMIUM — INAEV*\n\n` +
      `👤 User: \`${targetId}\`\n` +
      `❌ Status: *Bukan Premium*\n`,
      { parse_mode: "Markdown" }
    );
  }

  let ts = Number(info.premium_until);
  const d = new Date(ts);

  const valid = ts && !isNaN(ts) && !isNaN(d.getTime());

  // Legacy premium (tanpa expired)
  if (!valid) {
    return ctx.reply(
      `💎 *PREMIUM — INAEV*\n\n` +
      `👤 User: \`${targetId}\`\n` +
      `🌟 Tipe: *Premium Lifetime*\n`,
      { parse_mode: "Markdown" }
    );
  }

  const now = Date.now();
  const remaining = ts - now;

  if (remaining <= 0) {
    return ctx.reply(
      `⚠️ Premium user \`${targetId}\` sudah *expired*.`,
      { parse_mode: "Markdown" }
    );
  }

  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);

  const expireStr = d.toISOString().replace("T", " ").substring(0, 19);

  return ctx.reply(
    `💎 *PREMIUM STATUS — INAEV*\n\n` +
    `👤 User: \`${targetId}\`\n` +
    `⏱ Berakhir: \`${expireStr} UTC\`\n` +
    `📆 Sisa: *${days} hari*, *${hours} jam*\n`,
    { parse_mode: "Markdown" }
  );
});

// ========== COMMAND /listsender (OWNER ONLY) ==========

/* ============================================
   COMMAND: /listsender   (OWNER ONLY)
============================================ */
bot.command('listsender', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!isOwner(userId)) {
    return ctx.reply('❌ Hanya *Owner* yang bisa melihat daftar sender.', { parse_mode: 'Markdown' });
  }

  const senders = loadSenders();
  if (!senders.length) {
    return ctx.reply('📭 Belum ada sender yang tersimpan.\nHubungkan WhatsApp dengan /getpairing dulu.');
  }

  let text = '📡 *DAFTAR SENDER WHATSAPP*\n\n';

  senders.forEach((s, i) => {
    const lastOn = s.lastConnected
      ? new Date(s.lastConnected).toLocaleString('id-ID')
      : '-';
    const lastOff = s.lastDisconnected
      ? new Date(s.lastDisconnected).toLocaleString('id-ID')
      : '-';

    text += `*${i + 1}.* ${s.phone || s.id}\n`;
    text += `   • Status : ${s.status || 'unknown'}\n`;
    text += `   • Last ON : ${lastOn}\n`;
    text += `   • Last OFF: ${lastOff}\n\n`;
  });

  return ctx.reply(text, { parse_mode: 'Markdown' });
});

// ======================= /listpremium =======================

bot.command('listpremium', async (ctx) => {
  const requesterId = ctx.message.from.id;

  if (!isOwner(requesterId) && !isAdmin(requesterId)) {
    return ctx.reply('❌ Hanya *Owner/Admin* yang dapat melihat daftar premium.', {
      parse_mode: 'Markdown'
    });
  }

  const list = loadPremiumUsers();

  if (!list.length) {
    return ctx.reply('ℹ️ Belum ada user premium yang terdaftar di premium_users.json.');
  }

  const now = Date.now();
  const lines = [];

  lines.push('```');
  lines.push('[ LIST PREMIUM USERS ]');
  lines.push('');

  list.slice(0, 50).forEach((u, idx) => {
    const raw = u.premium_until;
    const ts = Number(raw);
    const d = new Date(ts);
    const valid = ts && !Number.isNaN(ts) && !Number.isNaN(d.getTime());

    let expireStr = '-';
    let status = 'PREMIUM NO-EXP (LEGACY)';

    if (valid) {
      expireStr = d.toISOString().replace('T', ' ').substring(0, 19);
      const remainingMs = ts - now;
      if (remainingMs <= 0) {
        status = 'EXPIRED';
      } else {
        const daysLeft = Math.floor(remainingMs / 86400000);
        status = `AKTIF (${daysLeft}h)`;
      }
    }

    lines.push(`${idx + 1}. ID: ${u.id}`);
    lines.push(`    Exp: ${expireStr} UTC`);
    lines.push(`    Sts: ${status}`);
    lines.push('');
  });

  if (list.length > 50) {
    lines.push(`... dan ${list.length - 50} lainnya`);
  }

  lines.push('```');

  const text = lines.join('\n');

  await ctx.reply(text, { parse_mode: 'MarkdownV2' });
});


// ========== SETCOOLDOWN ==========
bot.command('setcooldown', async (ctx) => {
  const executorId = ctx.from.id;

  if (!isOwner(executorId)) {
    return ctx.reply('❌ Hanya owner yang dapat menggunakan perintah ini.');
  }

  const messageText = ctx.message.text.trim();
  const args = messageText.split(' ').slice(1);

  if (args.length < 2) {
    return ctx.reply(
      '❌ Format salah!\n\n' +
      'Gunakan:\n' +
      '`/setcooldown <command> <detik>`\n\n' +
      'Contoh:\n' +
      '`/setcooldown cekbio 3`',
      { parse_mode: 'Markdown' }
    );
  }

  const feature = args[0].replace('/', '').toLowerCase();
  const seconds = parseFloat(args[1]);

  if (isNaN(seconds) || seconds < 0) {
    return ctx.reply('❌ Durasi cooldown tidak valid.');
  }

  const cfg = loadFeatureCooldown();
  cfg[feature] = seconds;
  saveFeatureCooldown(cfg);

  return ctx.reply(`✅ Cooldown fitur /${feature} telah diubah menjadi ${seconds} detik.`);
});


// ========== COMMAND /CEKID ==========
bot.command('cekid', async (ctx) => {
  try {
    const userId = ctx.message.from.id;
    const args = ctx.message.text ? ctx.message.text.trim().split(/\s+/).slice(1) : [];

    // Jika admin/owner menyertakan argumen username (belum reliable via username), beri petunjuk
    if (args.length > 0 && isAdmin(userId)) {
      const target = args[0].replace('@','');
      return ctx.reply(`🔍 Untuk mendapatkan ID seseorang secara otomatis, minta mereka mengirimkan /cekid ke bot.\n\n📌 Atau tambahkan mereka ke grup dan minta mereka kirim /cekid.`, { parse_mode: 'Markdown' });
    }

    const username = ctx.message.from.username ? `@${ctx.message.from.username}` : '(tidak ada username)';
    await ctx.reply(
      `🪪 *DATA USER*\n\n` +
      `🧍 Nama: ${ctx.message.from.first_name || '-'}\n` +
      `🏷 Username: ${username}\n` +
      `🆔 ID: \`${userId}\`\n\n` +
      `Gunakan ID ini untuk ditambahkan ke premium, admin, atau list izin.`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    console.error('Error in /cekid command', e);
    ctx.reply('❌ Terjadi kesalahan saat mengambil ID Anda.');
  }
});
// ========== COMMAND UTAMA - START ==========

// ======================= CONFIG FOTO MENU =======================

const PHOTO_FILE_ID = "AgACAgUAAxkBAAE-js5pK5wHxHG4NF1TV4xPVlfzmiMaegAChAxrG9jOWFUzXm3ebDwkjgEAAwIAA3kAAzYE";

// ======================= UTIL =======================

// Escape teks ke MarkdownV2 (versi aman, ga bikin regex error)
function escapeMarkdown(text) {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

// Edit message tapi aman dari error "message is not modified"
// dan otomatis bedain: lagi edit TEXT atau CAPTION FOTO
async function safeEdit(ctx, text, extra) {
  try {
    const msg = ctx.callbackQuery?.message;

    if (msg && msg.photo && msg.photo.length > 0) {
      // kalau asalnya pesan foto → edit caption
      return await ctx.editMessageCaption(text, extra);
    } else {
      // kalau asalnya pesan text → edit text
      return await ctx.editMessageText(text, extra);
    }
  } catch (e) {
    const desc = e.description || e.response?.description || '';
    if (desc.includes('message is not modified')) {
      return; // abaikan
    }
    console.error('editMessage error:', e);
    throw e;
  }
}

// helper kirim MENU (pakai foto kalau bukan edit)
async function replyMenuWithPhotoOrEdit(ctx, text, keyboard, isEdit = false) {
  const extra = {
    parse_mode: 'MarkdownV2',
    reply_markup: { inline_keyboard: keyboard }
  };

  if (isEdit) {
    return safeEdit(ctx, text, extra);
  }

  // kirim foto + caption menu
  return ctx.replyWithPhoto(getMenuPhoto(), {
    caption: text,
    ...extra
  });
}

// ======================= MAIN MENU =======================

async function sendStartMenu(ctx, isEdit = false) {
  const userId = ctx.from.id;
  const user = getUser(userId);

  const isOwnerStatus  = isOwner(userId);
  const isAdminStatus  = isAdmin(userId) && !isOwnerStatus;
  const isPremium      = user.status === 'premium';

  const text = [
    '```',
    '[ ɪɴᴀᴇᴠʙᴏᴛ - ᴍᴀɪɴ ᴍᴇɴᴜ ]',
    '',
    '• /about { CEK BOT }',
    '• /help  { PANDUAN }',
    '',
    `• ID USER : ${userId}`,
    `• OWNER   : ${isOwnerStatus ? '✅' : '❌'}`,
    `• ADMIN   : ${isAdminStatus ? '✅' : '❌'}`,
    `• PREMIUM : ${isPremium ? '✅' : '❌'}`,
    '```'
  ].join('\n');

  const keyboard = [];

  if (isPremium) {
    keyboard.push([{ text: '📦 ᴍᴇɴᴜ ᴘʀᴇᴍɪᴜᴍ', callback_data: 'open_premium_menu' }]);
  }
  if (isAdminStatus) {
    keyboard.push([{ text: '🛠 ᴍᴇɴᴜ ᴀᴅᴍɪɴ', callback_data: 'open_admin_menu' }]);
  }
  if (isOwnerStatus) {
    keyboard.push([{ text: '👑 ᴍᴇɴᴜ ᴏᴡɴᴇʀ', callback_data: 'open_owner_menu' }]);
  }

  return replyMenuWithPhotoOrEdit(ctx, text, keyboard, isEdit);
}

// ======================= MENU PREMIUM =======================

async function sendPremiumMenu(ctx, isEdit = false) {
  const text = [
    '```',
    '[ ᴍᴇɴᴜ ᴘʀᴇᴍɪᴜᴍ ]',
    '',
    '✧ /cekbio            { CEK 1 BIO }',
    '✧ /cekbiofile        { CEK BIO FILE }',
    '✧ /ceknomorterdaftar { CEK NOMOR TERDAFTAR }',
    '✧ /cekrange          { CEK RANGE NOMOR }',
    '✧ /cekrepe           { CEK NOMOR REPE }',
    '✧ /fix               { FIX NOMOR MERAH }',
    '✧ /cekid             { LIHAT ID TELEGRAM }',
    '✧ /cekpremium        { CEK STATUS PREMIUM }',
    '',
    '✧ /getpairing        { GET PAIRING WA }',
    '✧ /getqr             { GET QR WA }',
    '```'
  ].join('\n');

  const keyboard = [
    [{ text: '⬅️ ʙᴀᴄᴋ', callback_data: 'back_main_menu' }]
  ];

  return replyMenuWithPhotoOrEdit(ctx, text, keyboard, isEdit);
}

// ======================= MENU ADMIN =======================

async function sendAdminMenu(ctx, isEdit = false) {
  const text = [
    '```',
    '[ ᴍᴇɴᴜ ᴀᴅᴍɪɴ ]',
    '',
    '✧ /cekbio            { CEK 1 BIO }',
    '✧ /cekbiofile        { CEK BIO FILE }',
    '✧ /ceknomorterdaftar { CEK NOMOR TERDAFTAR }',
    '✧ /cekrange          { CEK RANGE NOMOR }',
    '✧ /cekrepe           { CEK NOMOR REPE }',
    '✧ /fix               { FIX NOMOR MERAH }',
    '✧ /cekid             { LIHAT ID TELEGRAM }',
    '',
    '✧ /addpremium        { TAMBAH PREMIUM }',
    '✧ /setpremium        { SET PREMIUM USER }',
    '✧ /delpremium        { HAPUS PREMIUM USER }',
    '✧ /cekpremium        { CEK STATUS PREMIUM }',
    '✧ /listpremium       { LIST USER PREMIUM }',
    '',
    '✧ /getpairing        { GET PAIRING WA }',
    '✧ /getqr             { GET QR WA }',
    '✧ /restartpanel      { HAPUS SESION }',
    '```'
  ].join('\n');

  const keyboard = [
    [{ text: '⬅️ ʙᴀᴄᴋ', callback_data: 'back_main_menu' }]
  ];

  return replyMenuWithPhotoOrEdit(ctx, text, keyboard, isEdit);
}

// ======================= MENU OWNER =======================

async function sendOwnerMenu(ctx, isEdit = false) {
  const text = [
    '```',
    '[ ᴍᴇɴᴜ ᴏᴡɴᴇʀ ]',
    '',
    '✧ /cekbio            { CEK 1 BIO }',
    '✧ /cekbiofile        { CEK BIO FILE }',
    '✧ /banding           { BANDING NOMOR }',
    '✧ /ceknomorterdaftar { CEK NOMOR TERDAFTAR }',
    '✧ /cekrange          { CEK RANGE NOMOR }',
    '✧ /cekrepe           { CEK NOMOR REPE }',
    '✧ /fix               { FIX NOMOR MERAH }',
    '✧ /cekid             { LIHAT ID TELEGRAM }',
    '',
    '✧ /addpremium        { TAMBAH PREMIUM }',
    '✧ /setpremium        { SET PREMIUM USER }',
    '✧ /delpremium        { HAPUS PREMIUM USER }',
    '✧ /cekpremium        { CEK STATUS PREMIUM }',
    '✧ /listpremium       { LIST USER PREMIUM }',
    '',
    '✧ /addadmin          { TAMBAH ADMIN }',
    '✧ /unadmin           { HAPUS ADMIN }',
    '✧ /listadmin         { LIST USER ADMIN }',
    '✧ /listsender        { LIST SENDER WA }',
    '',
    '✧ /globalmsg all      { BC KE SEMUA USER }',
    '✧ /globalmsg admin    { BC KE ADMIN }',
    '✧ /globalmsg premium  { BC KE PREMIUM }',
    '✧ /globalmsg staff    { BC KE ADMIN + PREMIUM }',
    '',
    '✧ /getpairing        { GET PAIRING WA }',
    '✧ /getqr             { GET QR WA }',
    '✧ /restartpanel      { HAPUS SESION }',
    '```'
  ].join('\n');

  const keyboard = [
    [{ text: '➡️ NEXT PAGE', callback_data: 'open_owner_menu_2' }],
    [{ text: '⬅️ BACK', callback_data: 'back_main_menu' }]
  ];

  return replyMenuWithPhotoOrEdit(ctx, text, keyboard, isEdit);
}

async function sendOwnerMenu2(ctx, isEdit = false) {
  const text = [
    '```',
    '[ ᴍᴇɴᴜ ᴏᴡɴᴇʀ — ᴘᴀɢᴇ 2 ]',
    '',
    '✧ /addowner      { TAMBAH OWNER }',
    '✧ /delowner      { HAPUS OWNER USER }',
    '✧ /setowner        { SET OWNER USER }',
    '✧ /listowner      { LIST USER OWNER }',
    '',
    '✧ /setcooldown       { SET COOLDOWN FITUR }',
    '✧ /setchannel        { SET CHANNEL WAJIB JOIN }',
    '',
    '⬅️ PREVIOUS PAGE',
    '```'
  ].join('\n');

  const keyboard = [
    [{ text: '⬅️ PREVIOUS PAGE', callback_data: 'open_owner_menu' }],
    [{ text: '⬅️ BACK', callback_data: 'back_main_menu' }]
  ];

  return replyMenuWithPhotoOrEdit(ctx, text, keyboard, isEdit);
}

// ======================= HANDLER TOMBOL =======================

bot.action('open_premium_menu', async (ctx) => {
  await ctx.answerCbQuery();
  return sendPremiumMenu(ctx, true);
});

bot.action('open_admin_menu', async (ctx) => {
  await ctx.answerCbQuery();
  return sendAdminMenu(ctx, true);
});

bot.action('open_owner_menu', async (ctx) => {
  await ctx.answerCbQuery();
  return sendOwnerMenu(ctx, true);
});

bot.action('open_owner_menu_2', async (ctx) => {
  await ctx.answerCbQuery();
  return sendOwnerMenu2(ctx, true);
});

bot.action('back_main_menu', async (ctx) => {
  await ctx.answerCbQuery();
  return sendStartMenu(ctx, true);
});

// ======================= COMMAND /start =======================

// ======================= COMMAND /start (VERSI FIX BLOCKQUOTE PINK) =======================

bot.command('start', async (ctx) => {
  const userId = ctx.from.id;
  const channel = loadRequiredChannel();
  const joined = await isUserInChannel(bot, userId);

  // ======== BELUM JOIN ========
  if (!joined) {
    const blockquote = [
      '>🚫 𝙰𝙺𝚂𝙴𝚂 𝚃𝙴𝚁𝙱𝙰𝚃𝙰𝚂',
      '>𝚄𝙽𝚃𝚄𝙺 𝙼𝙴𝙽𝙶𝙶𝚄𝙽𝙰𝙺𝙰𝙽 𝙱𝙾𝚃 𝙸𝙽𝙸, 𝚂𝙸𝙻𝙰𝙺𝙰𝙽 𝙰𝚃𝚄𝚁𝙰𝙽 𝙱𝙴𝚁𝙸𝙺𝚄𝚃:',
      '>',
      '> 1\\. 𝙶𝙰𝙱𝚄𝙽𝙶 𝙺𝙴 𝙲𝙷𝙰𝙽𝙽𝙴𝙻 𝚁𝙴𝚂𝙼𝙸\\.',
      '>  • 𝚂𝙴𝚃𝙴𝙻𝙰𝙷 𝙸𝚃𝚄, 𝙺𝙻𝙸𝙺 𝚃𝙾𝙼𝙱𝙾𝙻 “𝐒𝐔𝐃𝐀𝐇 𝐉𝐎𝐈𝐍”',
      '>',
      '> 𝚂𝙴𝚃𝙴𝙻𝙰𝙷 𝙼𝙴𝙽𝚈𝙴𝙻𝙴𝚂𝙰𝙸𝙺𝙰𝙽 𝚂𝙴𝙼𝚄𝙰 𝙻𝙰𝙽𝙶𝙺𝙰𝙷 𝙳𝙸 𝙰𝚃𝙰𝚂,',
      '> 𝙰𝙽𝙳𝙰 𝙳𝙰𝙿𝙰𝚃 𝙼𝙴𝙻𝙰𝙽𝙹𝚄𝚃𝙺𝙰𝙽 𝙼𝙴𝙽𝙶𝙶𝚄𝙽𝙰𝙺𝙰𝙽 𝙱𝙾𝚃\\.',
      '>',
      '> © 𝙸𝙽𝙰𝙴𝚅 / @itsInaev'
    ].join('\n');
    
    // 💥 kirim FOTO + CAPTION blockquote
    await ctx.replyWithPhoto(
      PHOTO_FILE_ID, 
      {
        caption: blockquote,
        parse_mode: "MarkdownV2",
        reply_markup: {
          inline_keyboard: [
            [{ text: "𝐉𝐎𝐈𝐍 𝐂𝐇𝐀𝐍𝐍𝐄𝐋", url: `https://t.me/${channel.replace('@','')}` }],
            [{ text: "𝐒𝐔𝐃𝐀𝐇 𝐉𝐎𝐈𝐍", callback_data: "check_join" }]
          ]
        }
      }
    );

    return;
  }

  // ======= SUDAH JOIN =======
  await ctx.reply(`@itsInaev 🚀`);
  return sendStartMenu(ctx, false);
});


// ======================= COMMAND /globalmsg =======================
// Hanya OWNER. Broadcast ke all / admin / premium / staff (admin+premium)

bot.command('globalmsg', async (ctx) => {
  const senderId = ctx.from.id;

  // Hanya OWNER
  if (!isOwner(senderId)) {
    return ctx.reply('❌ Command ini hanya untuk *Owner* bot.', {
      parse_mode: 'Markdown'
    });
  }

  const messageText = ctx.message.text || '';

  // buang "/globalmsg" + mention bot
  let argsText = messageText.replace(/^\/globalmsg(@\w+)?/i, '').trim();

  if (!argsText) {
    return ctx.reply(
      '❌ Format salah.\n\n' +
      'Gunakan:\n' +
      '`/globalmsg <target> <pesan>`\n\n' +
      '*Target yang tersedia:*\n' +
      '`all`      → semua user\n' +
      '`admin`    → admin saja\n' +
      '`premium`  → premium saja\n' +
      '`staff`    → admin + premium\n\n' +
      'Contoh:\n' +
      '`/globalmsg all Halo semua user!`\n' +
      '`/globalmsg premium Terima kasih sudah jadi user premium ❤️`',
      { parse_mode: 'Markdown' }
    );
  }

  const parts = argsText.split(' ');
  const target = parts.shift()?.toLowerCase(); // kata pertama = target
  const broadcastText = parts.join(' ').trim();

  if (!broadcastText) {
    return ctx.reply(
      '❌ Pesan broadcast tidak boleh kosong.\n\n' +
      'Contoh:\n' +
      '`/globalmsg all Halo semua user!`',
      { parse_mode: 'Markdown' }
    );
  }

  const allowedTargets = ['all', 'admin', 'premium', 'staff'];
  if (!allowedTargets.includes(target)) {
    return ctx.reply(
      '❌ Target tidak dikenal.\n\n' +
      '*Target yang valid:*\n' +
      '`all`, `admin`, `premium`, `staff` (admin+premium)',
      { parse_mode: 'Markdown' }
    );
  }

  // Ambil semua user dari database
  const allUsers = loadAllUsers();

  if (!allUsers.length) {
    return ctx.reply('ℹ️ Tidak ada user yang bisa dikirim broadcast.');
  }

  // Tentukan target penerima
  const targets = allUsers.filter((u) => {
    const id = u.id || u.user_id || u.userId;
    if (!id) return false;

    if (target === 'all') return true;
    if (target === 'admin') return isAdmin(id);
    if (target === 'premium') return isPremium(id);
    if (target === 'staff') return isAdmin(id) || isPremium(id);

    return false;
  });

  if (!targets.length) {
    return ctx.reply(
      `ℹ️ Tidak ada user yang cocok dengan target \`${target}\`.`,
      { parse_mode: 'Markdown' }
    );
  }

  // Konfirmasi ke owner
  await ctx.reply(
  `<b>📡 Mengirim broadcast</b>\n` +
  `Target: <code>${target}</code>\n` +
  `Jumlah: <b>${targets.length}</b> user\n\n` +
  `<b>Pesan:</b>\n<pre>${broadcastText}</pre>`,
  { parse_mode: 'HTML' }
);

  let sukses = 0;
  let gagal = 0;

  for (const u of targets) {
    const id = u.id || u.user_id || u.userId;
    if (!id) continue;

    try {
      await bot.telegram.sendMessage(
        id,
        `📢 *Pesan dari Owner InaevBOT:*\n\n${broadcastText}`,
        { parse_mode: 'Markdown' }
      );
      sukses++;
    } catch (e) {
      gagal++;
      // jangan matikan loop, cukup log
      console.error(`Gagal kirim globalmsg ke ${id}:`, e.message);
    }

    // small delay biar gak terlalu spam ke Telegram
    await new Promise((r) => setTimeout(r, 150));
  }

  await ctx.reply(
    `✅ Broadcast selesai.\n` +
    `Berhasil: *${sukses}* user\n` +
    `Gagal   : *${gagal}* user`,
    { parse_mode: 'Markdown' }
  );
});

// Handler untuk tombol Cek Verifikasi
// ========== COMMAND OWNER ONLY ==========

bot.command('about', async (ctx) => {
  const text = [
    '```',
    '[ ABOUT INAEVBOT ]',
    '',
    'Bot cekbio & tools WhatsApp.',
    'Developer : @itsInaev',
    'Version   : 1.0.0',
    'Platform  : Node.js + Telegraf + Baileys',
    '',
    'Dilarang jual ulang tanpa izin.',
    '```'
  ].join('\n');

  await ctx.reply(text, { parse_mode: 'MarkdownV2' });
});

bot.command('help', async (ctx) => {
  const text = [
    '```',
    '[ HELP & PANDUAN INAEVBOT ]',
    '',
    'Bot ini menyediakan layanan cekbio, tools WhatsApp,',
    'serta beberapa fitur eksklusif untuk premium/admin/owner.',
    '',
    'Cara penggunaan sangat mudah:',
    '1. Ketik /start untuk membuka menu utama.',
    '2. Tekan tombol yang tersedia sesuai kebutuhan.',
    '3. Ikuti instruksi pada menu yang muncul.',
    '',
    'Tidak perlu mengingat command.',
    'Semua fitur sudah disusun otomatis melalui tombol menu.',
    '',
    'Jika menemukan error atau membutuhkan bantuan,',
    'silakan hubungi owner bot:',
    '→ @itsInaev',
    '',
    'Terima kasih telah menggunakan InaevBOT.',
    '```'
  ].join('\n');

  await ctx.reply(text, { parse_mode: 'MarkdownV2' });
});

//bot.use((ctx, next) => {
  //if (ctx.update.message) {
    //console.log(JSON.stringify(ctx.update, null, 2));
  //}
  //return next(); // WAJIB, supaya handler lain tetap jalan
//});

bot.action('check_join', async (ctx) => {
  const userId = ctx.from.id;

  const joined = await isUserInChannel(bot, userId);

  if (!joined) {
    return ctx.answerCbQuery("⚠️ Kamu belum join channel!", { show_alert: true });
  }

  await ctx.answerCbQuery("✔️ Terverifikasi!");
  await ctx.reply(`@itsInaev 🚀`);
  return sendStartMenu(ctx, false);
});

bot.command('setchannel', async (ctx) => {
  const uid = ctx.from.id;

  if (!isOwner(uid)) {
    return ctx.reply("❌ Hanya owner yang dapat mengubah channel wajib join.");
  }

  const args = ctx.message.text.split(" ").slice(1);
  if (args.length < 1) {
    return ctx.reply("⚙️ Format: /setchannel @NamaChannel");
  }

  const newChannel = args[0];

  if (!newChannel.startsWith("@")) {
    return ctx.reply("❌ Channel harus diawali dengan @");
  }

  saveRequiredChannel(newChannel);
  REQUIRED_CHANNEL = newChannel;

  return ctx.reply(
    `✅ Channel wajib join berhasil diperbarui menjadi *${newChannel}*`,
    { parse_mode: "Markdown" }
  );
});

//anjay
// =============== FITUR BUY SCRIPT ===================
bot.command("buyscript", async (ctx) => {
  try {

    const caption = `
🔥 *OPEN SCRIPT CEKBIO TELEGRAM — PREMIUM EDITION*
Powered by INAev

👨‍💻 *Developer:* @itsInaev
💰 *Harga Script:* 20K (sekali beli, pakai selamanya)

📦 *Yang Kamu Dapatkan:*
• UI Premium + Menu Foto
• Main Menu, Admin Menu, Premium Menu
• Owner Menu 2 Halaman
• Inline Button Responsif & Elegan
• Sistem Cekbio Super Lengkap (TXT/CSV/XLSX)
• Tools WA Terintegrasi (/getqr, /getpairing, anti-crash)
• Sistem Wajib Join Channel (anti bypass)
• Broadcast Lengkap (all user, admin, premium)
• Session stabil cocok buat jasa WA Tools

🎁 *BONUS KHUSUS PEMBELI*
• Free Update Seumur Hidup
• Free Upgrade Fitur Otomatis via Auto Update
• Full Support Pemasangan
• Full Source Code — Tanpa Enkripsi
• Masuk Grup Diskusi Developer

Klik tombol di bawah untuk membeli.
    `.trim();

    await ctx.reply(caption, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💬 Hubungi Developer", url: "https://t.me/itsInaev" }],
          [{ text: "📂 Lihat Fitur Lengkap", url: "https://t.me/inaevch/56?single" }],
        ]
      }
    });

  } catch (err) {
    console.error("Error fitur /buyscript:", err);
    ctx.reply("❌ Error menampilkan informasi script.");
  }
});

bot.command('setfoto', async (ctx) => {
  const userId = ctx.from.id;

  // hanya owner
  if (!isOwner(userId)) {
    return ctx.reply("❌ Command ini khusus Owner.");
  }

  if (!ctx.message.reply_to_message || !ctx.message.reply_to_message.photo) {
    return ctx.reply("📸 Balas foto dengan perintah /setfoto");
  }

  try {
    const photoArray = ctx.message.reply_to_message.photo;
    const highestResPhoto = photoArray[photoArray.length - 1];
    const fileId = highestResPhoto.file_id;

    setMenuPhoto(fileId);

    return ctx.reply("✅ Foto menu berhasil diganti!");
  } catch (e) {
    console.error("SETFOTO ERROR:", e);
    return ctx.reply("❌ Gagal mengambil file_id foto.");
  }
});

bot.command("setowner", async (ctx) => {
  const executorId = ctx.from.id;

  // hanya owner utama yang boleh
  if (!isMainOwner(executorId)) {
    return ctx.reply("❌ Hanya owner utama yang dapat menggunakan setowner.");
  }

  let targetId;
  let days;

  const args = ctx.message.text.split(/\s+/).slice(1);

  // 1️⃣ Reply ke user + masukkan durasi
  if (ctx.message.reply_to_message && ctx.message.reply_to_message.from) {
    if (!args[0]) {
      return ctx.reply(
        "⚠️ Cara pakai:\n" +
        "/setowner <id> <hari>\n" +
        "/setowner <reply ke user> <hari>",
        { parse_mode: "Markdown" }
      );
    }

    targetId = ctx.message.reply_to_message.from.id;
    days = Number(args[0]);

  } else {
    // 2️⃣ id + durasi
    if (args.length < 2) {
      return ctx.reply(
        "⚠️ Cara pakai:\n" +
        "/setowner <id> <hari>\n" +
        "/setowner <reply ke user> <hari>",
        { parse_mode: "Markdown" }
      );
    }

    targetId = Number(args[0]);
    days = Number(args[1]);
  }

  if (isNaN(days) || days <= 0) {
    return ctx.reply("❌ Durasi hari tidak valid.");
  }

  const data = loadOwners();

  // jika sudah owner utama
  if (data.main.includes(targetId)) {
    return ctx.reply("⚠️ User ini sudah owner utama.");
  }

  // hitung timestamp kedaluwarsa
  const until = Math.floor(Date.now() / 1000) + (days * 86400);

  // jika sudah owner tambahan → update durasi
  const existing = data.extra.find(o => o.id === targetId);
  if (existing) {
    existing.until = until;
  } else {
    data.extra.push({ id: targetId, until });
  }

  saveOwners(data);

  return ctx.reply(
    `👑 *Owner Berhasil Diset*\n\n` +
    `• User ID: \`${targetId}\`\n` +
    `• Durasi: *${days} hari*\n` +
    `• Expired: <t:${until}:R>\n`,
    { parse_mode: "Markdown" }
  );
});

// =============== FITUR ADD OWNER ===============

bot.command("addowner", async (ctx) => {
  try {
    const executorId = ctx.from.id;

    // hanya owner utama boleh menambah owner
    if (!isMainOwner(executorId)) {
      return ctx.reply("❌ Hanya Owner Utama yang boleh menambah owner.");
    }

    const args = ctx.message.text.split(/\s+/).slice(1);

    let targetId;
    let days = 0; // optional

    // --- REPLY MODE ---
    if (ctx.message.reply_to_message && ctx.message.reply_to_message.from) {
      targetId = ctx.message.reply_to_message.from.id;
      days = Number(args[0] || 0);

    } else {
      if (!args[0]) {
        return ctx.reply(
          "⚠️ Cara pakai:\n" +
          "/addowner <id> <hari>\n" +
          "/addowner <reply> <hari>",
          { parse_mode: "Markdown" }
        );
      }

      // ID angka
      if (!isNaN(args[0])) {
        targetId = Number(args[0]);
      } else {
        return ctx.reply("❌ Hanya ID yang didukung.");
      }

      days = Number(args[1] || 0);
    }

    // Load data owner
    const data = loadOwners(); // { main: , extra: [] }

    // Cek double owner
    if (String(targetId) === String(OWNER_ID)) {
      return ctx.reply("⚠️ User ini sudah Owner Utama.");
    }
    if (data.extra.some(o => o.id === targetId)) {
      return ctx.reply("⚠️ User ini sudah Owner Tambahan.");
    }

    // Hitung masa aktif
    const now = Math.floor(Date.now() / 1000);
    const until = days > 0 ? now + (days * 24 * 60 * 60) : now + (30 * 24 * 60 * 60);

    // Tambahkan owner
    data.extra.push({ id: targetId, until });

    // Simpan
    saveOwners(data);

    return ctx.reply(
      `✅ *Owner berhasil ditambahkan*\n\n` +
      `👑 User ID: \`${targetId}\`\n` +
      `🕒 Masa aktif: *${days || 30} hari*`,
      { parse_mode: "Markdown" }
    );

  } catch (e) {
    console.error("AddOwner Error:", e);
    return ctx.reply("❌ Terjadi kesalahan sistem. Cek console server.");
  }
});

// ======================= LIST OWNER =======================
bot.command("listowner", async (ctx) => {
  const executorId = ctx.from.id;

  if (!isOwner(executorId)) {
    return ctx.reply("❌ Kamu tidak punya izin untuk melihat daftar owner.");
  }

  const data = loadOwners(); // { main: [], extra: [] }
  const now = Math.floor(Date.now() / 1000);

  if (!data || !data.main || !data.extra) {
    return ctx.reply("❌ File owners.json rusak atau tidak valid.");
  }

  let text = "👑 *DAFTAR OWNER BOT*\n\n";

  // Owner utama
  text += "👑 *Owner Utama:*\n";
  data.main.forEach((id) => {
    text += `• \`${id}\`\n`;
  });

  // Owner tambahan
  if (data.extra.length === 0) {
    text += "\n⚠️ *Tidak ada owner tambahan.*";
  } else {
    text += "\n⭐ *Owner Tambahan:*\n";

    data.extra.forEach((owner, i) => {
      const sisa = owner.until - now;
      const hari = Math.floor(sisa / 86400);
      const jam = Math.floor((sisa % 86400) / 3600);

      text += `${i + 1}. \`${owner.id}\`\n`;
      text += `   ⏳ Sisa: *${hari} hari ${jam} jam*\n`;
    });
  }

  ctx.reply(text, { parse_mode: "Markdown" });
});

// ======================= DEL OWNER =======================
bot.command("delowner", async (ctx) => {
  const executorId = ctx.from.id;

  // hanya owner yang boleh hapus owner
  if (!isOwner(executorId)) {
    return ctx.reply("❌ Kamu tidak punya izin untuk menghapus owner.");
  }

  let targetId;

  // jika reply
  if (ctx.message.reply_to_message && ctx.message.reply_to_message.from) {
    targetId = ctx.message.reply_to_message.from.id;

  } else {
    const args = ctx.message.text.split(/\s+/).slice(1);

    if (!args[0]) {
      return ctx.reply(
        "⚠️ Cara pakai:\n" +
        "/delowner <id>\n" +
        "/delowner <reply ke pesan user>",
        { parse_mode: "Markdown" }
      );
    }

    if (isNaN(args[0])) {
      return ctx.reply("❌ Hanya ID yang diterima. Username tidak didukung.");
    }

    targetId = Number(args[0]);
  }

  // tidak boleh hapus owner utama
  if (String(targetId) === String(OWNER_ID)) {
    return ctx.reply("❌ Tidak bisa menghapus *Owner Utama*.");
  }

  const data = loadOwners(); // { main: [], extra: [] }

  // cek apakah target ada di owner tambahan
  const exists = data.extra.some(o => o.id === targetId);

  if (!exists) {
    return ctx.reply("⚠️ User ini bukan owner tambahan.");
  }

  // hapus dari extra
  data.extra = data.extra.filter(o => o.id !== targetId);

  saveOwners(data);

  return ctx.reply(
    `🗑️ *Owner berhasil dihapus*\n\n❌ User ID: \`${targetId}\``,
    { parse_mode: "Markdown" }
  );
});

// ======================= ADD ADMIN =======================
bot.command("addadmin", async (ctx) => {
  const executorId = ctx.message.from.id;

  if (!isOwner(executorId)) {
    return ctx.reply("❌ Hanya *Owner* yang bisa menambah admin.", { parse_mode: "Markdown" });
  }

  let targetId = null;

  // 1️⃣ Reply Mode → /addadmin
  if (ctx.message.reply_to_message) {
    targetId = ctx.message.reply_to_message.from.id;
  }

  // 2️⃣ Mention Mode → /addadmin @user
  else if (ctx.message.entities && ctx.message.entities[1]?.user) {
    targetId = ctx.message.entities[1].user.id;
  }

  // 3️⃣ Manual Mode → /addadmin <id>
  else {
    const idRaw = ctx.message.text.split(" ")[1];
    if (!idRaw) {
      return ctx.reply("❌ Format:\n`/addadmin <id>` atau reply pesan.", { parse_mode: "Markdown" });
    }
    targetId = parseInt(idRaw);
  }

  if (!targetId || isNaN(targetId)) {
    return ctx.reply("❌ ID tidak valid.", { parse_mode: "Markdown" });
  }

  if (adminIds.includes(targetId)) {
    return ctx.reply(`ℹ️ User \`${targetId}\` sudah menjadi admin.`, { parse_mode: "Markdown" });
  }

  adminIds.push(targetId);
  saveAdmin();

  return ctx.reply(
    `🟢 *ADMIN DITAMBAHKAN*\n\n` +
    `👤 User: \`${targetId}\`\n` +
    `⚡ Sekarang menjadi *Admin INAEV*`,
    { parse_mode: "Markdown" }
  );
});


// ======================= REMOVE ADMIN =======================
bot.command("unadmin", async (ctx) => {
  const executorId = ctx.message.from.id;

  if (!isOwner(executorId)) {
    return ctx.reply("❌ Hanya *Owner* yang bisa menghapus admin.", { parse_mode: "Markdown" });
  }

  let targetId = null;

  // 1️⃣ Reply Mode
  if (ctx.message.reply_to_message) {
    targetId = ctx.message.reply_to_message.from.id;
  }

  // 2️⃣ Mention Mode
  else if (ctx.message.entities && ctx.message.entities[1]?.user) {
    targetId = ctx.message.entities[1].user.id;
  }

  // 3️⃣ Manual Mode
  else {
    const idRaw = ctx.message.text.split(" ")[1];
    if (!idRaw) {
      return ctx.reply("❌ Format:\n`/unadmin <id>` atau reply pesan.", { parse_mode: "Markdown" });
    }
    targetId = parseInt(idRaw);
  }

  if (!targetId || isNaN(targetId)) {
    return ctx.reply("❌ ID tidak valid.", { parse_mode: "Markdown" });
  }

  if (!adminIds.includes(targetId)) {
    return ctx.reply(
      `ℹ️ User \`${targetId}\` *bukan admin*.`,
      { parse_mode: "Markdown" }
    );
  }

  adminIds = adminIds.filter((id) => id !== targetId);
  saveAdmin();

  return ctx.reply(
    `🟥 *ADMIN DIHAPUS*\n\n` +
    `👤 User: \`${targetId}\`\n` +
    `⚡ Tidak lagi menjadi admin INAEV.`,
    { parse_mode: "Markdown" }
  );
});


// ======================= LIST ADMIN =======================
bot.command("listadmin", async (ctx) => {
  const executorId = ctx.message.from.id;

  if (!isOwner(executorId)) {
    return ctx.reply("❌ Hanya *Owner* yang bisa melihat daftar admin.", { parse_mode: "Markdown" });
  }

  loadOwners();

  let text = `🔥 *DAFTAR ADMIN INAEV*\n━━━━━━━━━━━\n\n`;
  text += `👑 *OWNER*\n• \`${OWNER_ID}\`\n\n`;

  if (adminIds.length === 0) {
    text += `⚠️ Tidak ada admin terdaftar.\n`;
  } else {
    text += `🛠 *ADMIN LIST*\n`;
    adminIds.forEach((id, i) => {
      text += `• ${i + 1}. \`${id}\`\n`;
    });
  }

  ctx.reply(text, { parse_mode: "Markdown" });
});


// ========== COMMAND UNTUK SEMUA PENGGUNA ==========

// Command /cekbio dengan batch size 20 dan cooldown 1000 detik - DENGAN FITUR BARU META BUSINESS & PERSENTASE JAM
bot.command('cekbio', async (ctx) => {
  const chatId = ctx.message.chat.id;
  const userId = ctx.message.from.id;

  // ========== CEK COOLDOWN FITUR ==========
  const cd = checkFeatureCooldown(userId, 'cekbio');
  if (!cd.allowed) {
    return ctx.reply(`⏳ Tunggu ${cd.remaining.toFixed(1)} detik sebelum menggunakan /cekbio lagi.`);
  }
    
    // Akses: Owner/Admin/Premium saja
  if (!isAllowed(userId)) {
    return ctx.reply('❌ Hanya Owner/Admin/Premium yang bisa menggunakan fitur ini.', { parse_mode: 'Markdown' });
  }

if (!isAllowed(userId)) {
    return ctx.reply('❌ Kamu belum terverifikasi! Join grup via tombol di /start untuk menggunakan bot.');
  }

  // Cek cooldown - 1000 DETIK (GLOBAL)
  const cooldown = checkCooldown(userId);
  if (!cooldown.allowed) {
    return ctx.reply(`⏰ Kamu harus menunggu ${cooldown.remaining} detik sebelum bisa menggunakan fitur ini lagi.`);
  }

  if (!isWhatsAppConnected || !whatsappSock) {
    return ctx.reply('❌ belum ada sender terdaftar!\n\nuntuk mulai menggunakan bot, Anda harus menambahkan dan menghubungkan sender WhatsApp.\n\nSilakan pairing menggunakan perintah:\n👉 /getpairing <nomor_whatsapp>');
  }

  const messageText = ctx.message.text;
  const numbersText = messageText.replace('/cekbio', '').trim();
  const numbers = numbersText.split(/[\s,\n]+/).filter(num => num.length > 0);
  
  if (numbers.length === 0) {
    return ctx.reply(
      '❌ Format salah!\n\n' +
      '✅ Gunakan: `/cekbio nomor1 nomor2 nomor3`\n' +
      '📝 Contoh: `/cekbio 628123456789 628987654321`\n\n' +
      '💡 *Note:* Maksimal 300 nomor per request',
      { parse_mode: 'Markdown' }
    );
  }

  const validNumbers = numbers.slice(0, 300).map(num => {
    let cleanNum = num.replace(/\D/g, '');
    if (cleanNum.startsWith('0')) {
      cleanNum = '62' + cleanNum.substring(1);
    } else if (cleanNum.startsWith('8')) {
      cleanNum = '62' + cleanNum;
    }
    return cleanNum;
  }).filter(num => num.length >= 10 && num.length <= 15);

  if (validNumbers.length === 0) {
    return ctx.reply('❌ Tidak ada nomor yang valid. Pastikan format nomor benar.');
  }

  try {
    // Animasi mengetik
    await ctx.telegram.sendChatAction(chatId, 'typing');
    let progressMessage = await ctx.reply(`⏳ Memulai pengecekan 0/${validNumbers.length} nomor...`);
    let results = [];
    let processedCount = 0;

    const updateProgress = async (current, total, currentNumber = '') => {
      const progressBar = createProgressBar(current, total);
      const message = `⏳ ${progressBar} ${current.toString().padStart(5)}/${total}\n📱 Sedang memproses: ${currentNumber || '...'}\n📁 Sumber: Input Manual`;
      
      try {
        await ctx.telegram.editMessageText(
          chatId,
          progressMessage.message_id,
          null,
          message
        );
      } catch (error) {
        // Ignore edit errors
      }
    };

    // BATCH SIZE 20 untuk lebih stabil
    const batchSize = 20;
    
    for (let i = 0; i < validNumbers.length; i += batchSize) {
      const batch = validNumbers.slice(i, i + batchSize);
      const batchPromises = batch.map(async (num) => {
        try {
          const jid = num + "@s.whatsapp.net";
          
          const [waCheck] = await whatsappSock.onWhatsApp(jid);
          
          if (!waCheck || !waCheck.exists) {
            return {
              number: num,
              registered: false,
              bio: null,
              setAt: null,
              metaBusiness: false
            };
          }

          let bioData = null;
          let setAt = null;
          let metaBusiness = false;
          
          try {
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Cek bio/status
            const statusResult = await whatsappSock.fetchStatus(jid);
            if (statusResult && statusResult[0] && statusResult[0].status) {
              bioData = statusResult[0].status.status || "";
              setAt = statusResult[0].status.setAt ? new Date(statusResult[0].status.setAt) : null;
            }
          } catch (bioError) {
            bioData = "";
          }

          // FITUR BARU: Cek Meta Business
          try {
            const businessCheck = await checkMetaBusiness(jid);
            metaBusiness = businessCheck.isBusiness;
          } catch (businessError) {
            metaBusiness = false;
          }

          // Hitung persentase tidak ngejam
          const jamPercentage = getJamPercentage(bioData, setAt, metaBusiness);

          return {
            number: num,
            registered: true,
            bio: bioData,
            setAt: setAt,
            metaBusiness: metaBusiness,
            jamPercentage: jamPercentage
          };
          
        } catch (error) {
          return {
            number: num,
            registered: false,
            bio: null,
            setAt: null,
            metaBusiness: false,
            error: true
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      processedCount += batch.length;
      
      await updateProgress(processedCount, validNumbers.length, batch[0]);
      
      if (i + batchSize < validNumbers.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    await ctx.telegram.editMessageText(
      chatId,
      progressMessage.message_id,
      null,
      '📊 Menyusun hasil...'
    );

    const filename = createBioResultFile(results, validNumbers.length);
    
    await ctx.replyWithDocument(
      { source: filename },
      {
        caption: `📋 *HASIL CEK BIO WHATSAPP*\n\n` +
                `📊 Total: ${validNumbers.length} nomor\n` +
                `✅ Terdaftar: ${results.filter(r => r.registered).length}\n` +
                `❌ Tidak terdaftar: ${results.filter(r => !r.registered).length}\n` +
                `📝 Dengan bio: ${results.filter(r => r.registered && r.bio && r.bio.length > 0).length}\n` +
                `🏢 Meta Business: ${results.filter(r => r.metaBusiness).length}\n\n` +
                `🕒 ${new Date().toLocaleString('id-ID')}`,
        parse_mode: 'Markdown'
      }
    );

    setTimeout(() => {
      try {
        fs.unlinkSync(filename);
      } catch (e) {
        console.log('Gagal menghapus file temporary:', e.message);
      }
    }, 5000);

    try {
      await ctx.telegram.deleteMessage(chatId, progressMessage.message_id);
    } catch (e) {}
  } catch (error) {
    console.error('Error dalam command cekbio:', error);
    ctx.reply('❌ Terjadi kesalahan sistem. Coba lagi beberapa saat.');
  }
});

// Command /cekbiofile dengan cooldown 1000 detik - FITUR BARU DENGAN META BUSINESS & PERSENTASE JAM
bot.command('cekbiofile', async (ctx) => {
  const chatId = ctx.message.chat.id;
  const userId = ctx.message.from.id;

// Akses: Owner/Admin/Premium saja
  if (!isAllowed(userId)) {
    return ctx.reply('❌ Hanya Owner/Admin/Premium yang bisa menggunakan fitur ini.', { parse_mode: 'Markdown' });
  }
    
    // Akses: Owner/Admin/Premium saja
  if (!isAllowed(userId)) {
    return ctx.reply('❌ Hanya Owner/Admin/Premium yang bisa menggunakan fitur ini.', { parse_mode: 'Markdown' });
  }

if (!isAllowed(userId)) {
    return ctx.reply('❌ Kamu belum terverifikasi! Join grup via tombol di /start untuk menggunakan bot.');
  }

  // Cek cooldown - 1000 DETIK (GLOBAL)
  const cooldown = checkCooldown(userId);
  if (!cooldown.allowed) {
    return ctx.reply(`⏰ Kamu harus menunggu ${cooldown.remaining} detik sebelum bisa menggunakan fitur ini lagi.`);
  }

  if (!isWhatsAppConnected || !whatsappSock) {
    return ctx.reply('❌ belum ada sender terdaftar!\n\nuntuk mulai menggunakan bot, Anda harus menambahkan dan menghubungkan sender WhatsApp.\n\nSilakan pairing menggunakan perintah:\n👉 /getpairing <nomor_whatsapp>');
  }

  // Cek apakah user mereply ke sebuah pesan
  if (!ctx.message.reply_to_message) {
    return ctx.reply(
      '❌ Format salah!\n\n' +
      '✅ Gunakan: Reply file TXT/CSV/XLSX dengan command `/cekbiofile`\n' +
      '📝 Contoh: Kirim file berisi nomor, lalu reply file tersebut dengan `/cekbiofile`\n\n' +
      '💡 *Note:* Mendukung format TXT, CSV, dan XLSX\n' +
      '💡 *Fitur:* Tidak ada batasan jumlah nomor',
      { parse_mode: 'Markdown' }
    );
  }

  const repliedMessage = ctx.message.reply_to_message;

  // Cek apakah pesan yang di-reply adalah file document
  if (!repliedMessage.document) {
    return ctx.reply('❌ Harap reply ke file TXT/CSV/XLSX yang berisi daftar nomor.');
  }

  const fileName = repliedMessage.document.file_name || '';
  const supportedFormats = ['txt', 'csv', 'xlsx'];
  const fileExtension = fileName.toLowerCase().split('.').pop();

  if (!supportedFormats.includes(fileExtension)) {
    return ctx.reply('❌ Format file tidak didukung. Gunakan file TXT, CSV, atau XLSX.');
  }

  try {
    // Animasi mengetik
    await ctx.telegram.sendChatAction(chatId, 'typing');
    
    // Download file menggunakan fungsi baru
    const fileBuffer = await downloadTelegramFile(repliedMessage.document.file_id, fileName);
    
    // Parse nomor dari file
    const numbers = await processFile(fileBuffer, fileName);
    
    if (numbers.length === 0) {
      return ctx.reply('❌ File tidak berisi nomor yang valid.');
    }

    // Validasi dan format nomor
    const validNumbers = numbers.map(num => {
      let cleanNum = num.replace(/\D/g, '');
      if (cleanNum.startsWith('0')) {
        cleanNum = '62' + cleanNum.substring(1);
      } else if (cleanNum.startsWith('8')) {
        cleanNum = '62' + cleanNum;
      }
      return cleanNum;
    }).filter(num => num.length >= 10 && num.length <= 15);

    if (validNumbers.length === 0) {
      return ctx.reply('❌ Tidak ada nomor yang valid dalam file.');
    }

    // Beri peringatan jika jumlah nomor sangat banyak
    if (validNumbers.length > 1000) {
      await ctx.reply(`⚠️ Peringatan: Anda akan memproses ${validNumbers.length} nomor. Proses mungkin memakan waktu lama.`);
    }

    let progressMessage = await ctx.reply(`⏳ Memulai pengecekan 0/${validNumbers.length} nomor...`);
    let results = [];
    let processedCount = 0;

    const fileSourceType = getFileSourceType(fileName);

    const updateProgress = async (current, total, currentNumber = '') => {
      const progressBar = createProgressBar(current, total);
      const message = `⏳ ${progressBar} ${current.toString().padStart(5)}/${total}\n📱 Sedang memproses: ${currentNumber || '...'}\n📁 Sumber: ${fileSourceType}`;
      
      try {
        await ctx.telegram.editMessageText(
          chatId,
          progressMessage.message_id,
          null,
          message
        );
      } catch (error) {
        // Ignore edit errors
      }
    };

    // BATCH SIZE 20 untuk lebih stabil
    const batchSize = 20;
    
    for (let i = 0; i < validNumbers.length; i += batchSize) {
      const batch = validNumbers.slice(i, i + batchSize);
      const batchPromises = batch.map(async (num) => {
        try {
          const jid = num + "@s.whatsapp.net";
          
          const [waCheck] = await whatsappSock.onWhatsApp(jid);
          
          if (!waCheck || !waCheck.exists) {
            return {
              number: num,
              registered: false,
              bio: null,
              setAt: null,
              metaBusiness: false
            };
          }

          let bioData = null;
          let setAt = null;
          let metaBusiness = false;
          
          try {
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Cek bio/status
            const statusResult = await whatsappSock.fetchStatus(jid);
            if (statusResult && statusResult[0] && statusResult[0].status) {
              bioData = statusResult[0].status.status || "";
              setAt = statusResult[0].status.setAt ? new Date(statusResult[0].status.setAt) : null;
            }
          } catch (bioError) {
            bioData = "";
          }

          // FITUR BARU: Cek Meta Business
          try {
            const businessCheck = await checkMetaBusiness(jid);
            metaBusiness = businessCheck.isBusiness;
          } catch (businessError) {
            metaBusiness = false;
          }

          // Hitung persentase tidak ngejam
          const jamPercentage = getJamPercentage(bioData, setAt, metaBusiness);

          return {
            number: num,
            registered: true,
            bio: bioData,
            setAt: setAt,
            metaBusiness: metaBusiness,
            jamPercentage: jamPercentage
          };
          
        } catch (error) {
          return {
            number: num,
            registered: false,
            bio: null,
            setAt: null,
            metaBusiness: false,
            error: true
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      processedCount += batch.length;
      
      await updateProgress(processedCount, validNumbers.length, batch[0]);
      
      if (i + batchSize < validNumbers.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    await ctx.telegram.editMessageText(
      chatId,
      progressMessage.message_id,
      null,
      '📊 Menyusun hasil...'
    );

    const filename = createBioResultFile(results, validNumbers.length, fileSourceType);
    
    await ctx.replyWithDocument(
      { source: filename },
      {
        caption: `📋 *HASIL CEK BIO WHATSAPP DARI ${fileSourceType.toUpperCase()}*\n\n` +
                `📊 Total: ${validNumbers.length} nomor\n` +
                `✅ Terdaftar: ${results.filter(r => r.registered).length}\n` +
                `❌ Tidak terdaftar: ${results.filter(r => !r.registered).length}\n` +
                `📝 Dengan bio: ${results.filter(r => r.registered && r.bio && r.bio.length > 0).length}\n` +
                `🏢 Meta Business: ${results.filter(r => r.metaBusiness).length}\n\n` +
                `📁 File: ${fileName}\n` +
                `🕒 ${new Date().toLocaleString('id-ID')}`,
        parse_mode: 'Markdown'
      }
    );

    setTimeout(() => {
      try {
        fs.unlinkSync(filename);
      } catch (e) {
        console.log('Gagal menghapus file temporary:', e.message);
      }
    }, 5000);

    try {
      await ctx.telegram.deleteMessage(chatId, progressMessage.message_id);
    } catch (e) {}
  } catch (error) {
    console.error('Error dalam command cekbiofile:', error);
    ctx.reply(`❌ Terjadi kesalahan sistem: ${error.message}. Pastikan file berisi nomor yang valid dan coba lagi.`);
  }
});

// Command /ceknomorterdaftar dengan cooldown 1000 detik
bot.command('ceknomorterdaftar', async (ctx) => {
  const userId = ctx.message.from.id;
  
    // Akses: Owner/Admin/Premium saja
  if (!isAllowed(userId)) {
    return ctx.reply('❌ Hanya Owner/Admin/Premium yang bisa menggunakan fitur ini.', { parse_mode: 'Markdown' });
  }

if (!isAllowed(userId)) {
    return ctx.reply('❌ Kamu belum terverifikasi! Join grup via tombol di /start untuk menggunakan bot.');
  }

  // Cek cooldown - 1000 DETIK (GLOBAL)
  const cooldown = checkCooldown(userId);
  if (!cooldown.allowed) {
    return ctx.reply(`⏰ Kamu harus menunggu ${cooldown.remaining} detik sebelum bisa menggunakan fitur ini lagi.`);
  }

  if (!isWhatsAppConnected || !whatsappSock) {
    return ctx.reply('❌ belum ada sender terdaftar!\n\nuntuk mulai menggunakan bot, Anda harus menambahkan dan menghubungkan sender WhatsApp.\n\nSilakan pairing menggunakan perintah:\n👉 /getpairing <nomor_whatsapp>');
  }

  const messageText = ctx.message.text;
  const numbersText = messageText.replace('/ceknomorterdaftar', '').trim();
  const numbers = numbersText.split(/[\s,\n]+/).filter(num => num.length > 0);
  
  if (numbers.length === 0) {
    return ctx.reply('❌ Format: /ceknomorterdaftar <nomor1> <nomor2> ...\n\n💡 Maksimal 300 nomor per request');
  }

  const validNumbers = numbers.slice(0, 300).map(num => {
    let cleanNum = num.replace(/\D/g, '');
    if (cleanNum.startsWith('0')) {
      cleanNum = '62' + cleanNum.substring(1);
    } else if (cleanNum.startsWith('8')) {
      cleanNum = '62' + cleanNum;
    }
    return cleanNum;
  }).filter(num => num.length >= 10 && num.length <= 15);

  if (validNumbers.length === 0) {
    return ctx.reply('❌ Tidak ada nomor yang valid.');
  }

  try {
    // Animasi mengetik
    await ctx.telegram.sendChatAction(ctx.message.chat.id, 'typing');
    
    const progressMessage = await ctx.reply(`⏳ Memulai pengecekan status 0/${validNumbers.length} nomor...`);
    let registered = [];
    let notRegistered = [];

    const batchSize = 20;
    
    for (let i = 0; i < validNumbers.length; i += batchSize) {
      const batch = validNumbers.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (num) => {
        try {
          const jid = num + "@s.whatsapp.net";
          const [waCheck] = await whatsappSock.onWhatsApp(jid);
          
          if (waCheck && waCheck.exists) {
            return { num, status: 'registered' };
          } else {
            return { num, status: 'not_registered' };
          }
        } catch (e) {
          return { num, status: 'error' };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      
      batchResults.forEach(result => {
        if (result.status === 'registered') {
          registered.push(result.num);
        } else {
          notRegistered.push(result.num);
        }
      });

      const processed = Math.min(i + batchSize, validNumbers.length);
      try {
        await ctx.telegram.editMessageText(
          ctx.message.chat.id,
          progressMessage.message_id,
          null,
          `⏳ Memeriksa ${processed}/${validNumbers.length} nomor...`
        );
      } catch (e) {}

      if (i + batchSize < validNumbers.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    let fileContent = `📊 Hasil cek status ${validNumbers.length} nomor\n\n`;

    if (registered.length) {
      fileContent += `✅ Terdaftar (${registered.length}):\n`;
      registered.forEach((num, idx) => {
        fileContent += `${idx + 1}. ${num}\n`;
      });
      fileContent += `\n`;
    }

    if (notRegistered.length) {
      fileContent += `❌ Tidak terdaftar (${notRegistered.length}):\n`;
      notRegistered.forEach((num, idx) => {
        fileContent += `${idx + 1}. ${num}\n`;
      });
    }

    const filename = `status_result_${Date.now()}.txt`;
    fs.writeFileSync(filename, fileContent);

    await ctx.replyWithDocument(
      { source: filename },
      { caption: `📊 Hasil pengecekan status ${validNumbers.length} nomor selesai!` }
    );
    
    try {
      await ctx.telegram.deleteMessage(ctx.message.chat.id, progressMessage.message_id);
    } catch (e) {}
    
    fs.unlinkSync(filename);
  } catch (error) {
    console.error('Error dalam command ceknomorterdaftar:', error);
    ctx.reply('❌ Terjadi kesalahan sistem.');
  }
});

// Command /cekrange dengan cooldown 1000 detik
bot.command('cekrange', async (ctx) => {
  const userId = ctx.message.from.id;
  
    // Akses: Owner/Admin/Premium saja
  if (!isAllowed(userId)) {
    return ctx.reply('❌ Hanya Owner/Admin/Premium yang bisa menggunakan fitur ini.', { parse_mode: 'Markdown' });
  }

if (!isAllowed(userId)) {
    return ctx.reply('❌ Kamu belum terverifikasi! Join grup via tombol di /start untuk menggunakan bot.');
  }

  // Cek cooldown - 1000 DETIK (GLOBAL)
  const cooldown = checkCooldown(userId);
  if (!cooldown.allowed) {
    return ctx.reply(`⏰ Kamu harus menunggu ${cooldown.remaining} detik sebelum bisa menggunakan fitur ini lagi.`);
  }

  if (!isWhatsAppConnected || !whatsappSock) {
    return ctx.reply('❌ belum ada sender terdaftar!\n\nuntuk mulai menggunakan bot, Anda harus menambahkan dan menghubungkan sender WhatsApp.\n\nSilakan pairing menggunakan perintah:\n👉 /getpairing <nomor_whatsapp>');
  }

  const messageText = ctx.message.text;
  const args = messageText.replace('/cekrange', '').trim().split(/\s+/);
  
  if (args.length < 3) {
    return ctx.reply(
      '❌ Format: /cekrange <prefix> <start> <end>\n\n' +
      '📝 Contoh: `/cekrange 628 1234 1250`\n' +
      '💡 *Note:* Prefix akan digabung dengan angka range\n' +
      '💡 Maksimal 300 nomor per request',
      { parse_mode: 'Markdown' }
    );
  }

  const prefix = args[0];
  const start = parseInt(args[1]);
  const end = parseInt(args[2]);

  if (isNaN(start) || isNaN(end)) {
    return ctx.reply('❌ Start dan end harus berupa angka.');
  }

  const range = end - start + 1;
  if (range > 300) {
    return ctx.reply(`❌ Range terlalu besar. Maksimal 300 nomor, kamu meminta ${range} nomor.`);
  }

  if (range <= 0) {
    return ctx.reply('❌ Range tidak valid. End harus lebih besar dari start.');
  }

  // Bersihkan prefix dan format ke format internasional
  let cleanPrefix = prefix.replace(/\D/g, '');
  if (cleanPrefix.startsWith('0')) {
    cleanPrefix = '62' + cleanPrefix.substring(1);
  } else if (cleanPrefix.startsWith('8')) {
    cleanPrefix = '62' + cleanPrefix;
  }

  const numbers = [];
  for (let i = start; i <= end; i++) {
    numbers.push(cleanPrefix + i);
  }

  try {
    // Animasi mengetik
    await ctx.telegram.sendChatAction(ctx.message.chat.id, 'typing');
    
    const progressMessage = await ctx.reply(`⏳ Memulai pengecekan range 0/${numbers.length} nomor...`);
    let registered = [];
    let notRegistered = [];

    const batchSize = 20;
    
    for (let i = 0; i < numbers.length; i += batchSize) {
      const batch = numbers.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (num) => {
        try {
          const jid = num + "@s.whatsapp.net";
          const [waCheck] = await whatsappSock.onWhatsApp(jid);
          
          if (waCheck && waCheck.exists) {
            return { num, status: 'registered' };
          } else {
            return { num, status: 'not_registered' };
          }
        } catch (e) {
          return { num, status: 'error' };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      
      batchResults.forEach(result => {
        if (result.status === 'registered') {
          registered.push(result.num);
        } else {
          notRegistered.push(result.num);
        }
      });

      const processed = Math.min(i + batchSize, numbers.length);
      try {
        await ctx.telegram.editMessageText(
          ctx.message.chat.id,
          progressMessage.message_id,
          null,
          `⏳ Memeriksa ${processed}/${numbers.length} nomor...`
        );
      } catch (e) {}

      if (i + batchSize < numbers.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    let fileContent = `📊 Hasil cek range ${numbers.length} nomor\n\n`;
    fileContent += `Prefix: ${prefix}\n`;
    fileContent += `Range: ${start} - ${end}\n`;
    fileContent += `Prefix Clean: ${cleanPrefix}\n\n`;

    if (registered.length) {
      fileContent += `✅ Terdaftar (${registered.length}):\n`;
      registered.forEach((num, idx) => {
        fileContent += `${idx + 1}. ${num}\n`;
      });
      fileContent += `\n`;
    }

    if (notRegistered.length) {
      fileContent += `❌ Tidak terdaftar (${notRegistered.length}):\n`;
      notRegistered.forEach((num, idx) => {
        fileContent += `${idx + 1}. ${num}\n`;
      });
    }

    const filename = `range_result_${Date.now()}.txt`;
    fs.writeFileSync(filename, fileContent);

    await ctx.replyWithDocument(
      { source: filename },
      { 
        caption: `📊 Hasil pengecekan range ${start}-${end} selesai!\n` +
                `✅ Terdaftar: ${registered.length}\n` +
                `❌ Tidak terdaftar: ${notRegistered.length}\n` +
                `🔢 Prefix: ${cleanPrefix}`
      }
    );
    
    try {
      await ctx.telegram.deleteMessage(ctx.message.chat.id, progressMessage.message_id);
    } catch (e) {}
    
    fs.unlinkSync(filename);
  } catch (error) {
    console.error('Error dalam command cekrange:', error);
    ctx.reply('❌ Terjadi kesalahan sistem.');
  }
});

// Command /banding dengan cooldown 1000 detik
bot.command('banding', async (ctx) => {
  const userId = ctx.message.from.id;

  // ============================
  //  🔐 AKSES: OWNER ONLY
  // ============================
  if (!isOwner(userId)) {
    return ctx.reply('❌ Hanya *Owner* yang dapat menggunakan perintah ini.', {
      parse_mode: 'Markdown'
    });
  }

  const messageText = ctx.message.text;
  const args = messageText.replace('/banding', '').trim().split(/\s+/);

  if (args.length === 0 || !args[0]) {
    return ctx.reply(
      '❌ Format: /banding <nomor_whatsapp>\n\n📝 Contoh: `/banding 628123456789`',
      { parse_mode: 'Markdown' }
    );
  }

  // ============================
  //  🔧 FIX FORMAT NOMOR
  // ============================
  let number = args[0].replace(/\D/g, '');

  if (number.startsWith('0')) {
    number = '62' + number.substring(1);
  } else if (number.startsWith('8')) {
    number = '62' + number;
  }

  if (number.length < 10 || number.length > 15) {
    return ctx.reply('❌ Format nomor tidak valid.');
  }

  // Animasi mengetik
  await ctx.telegram.sendChatAction(ctx.message.chat.id, 'typing');

  // ============================
  //  🔥 GENERATE DATA BANDING
  // ============================
  const randomName = getRandomName();
  const appealMessage = getRandomAppealMessage(randomName, number);
  const percentage = getVerificationPercentage(number);

  const resultText =
    `📋 *HASIL BANDING WHATSAPP*\n\n` +
    `📱 Nomor: +${number}\n` +
    `👤 Nama: ${randomName}\n` +
    `📊 Persentase Verifikasi: ${percentage}%\n\n` +
    `📝 *Pesan Banding:*\n${appealMessage}\n\n` +
    `📧 *Email WhatsApp:*\n${WHATSAPP_EMAIL}\n\n` +
    `💡 *Tips:* Kirim pesan di atas ke email WhatsApp untuk proses banding.`;

  await ctx.reply(resultText, { parse_mode: 'Markdown' });
});

// Command /cekrepe dengan cooldown 1000 detik
bot.command('cekrepe', async (ctx) => {
  const userId = ctx.message.from.id;
  
    // Akses: Owner/Admin/Premium saja
  if (!isAllowed(userId)) {
    return ctx.reply('❌ Hanya Owner/Admin/Premium yang bisa menggunakan fitur ini.', { parse_mode: 'Markdown' });
  }

if (!isAllowed(userId)) {
    return ctx.reply('❌ Kamu belum terverifikasi! Join grup via tombol di /start untuk menggunakan bot.');
  }

  // Cek cooldown - 1000 DETIK (GLOBAL)
  const cooldown = checkCooldown(userId);
  if (!cooldown.allowed) {
    return ctx.reply(`⏰ Kamu harus menunggu ${cooldown.remaining} detik sebelum bisa menggunakan fitur ini lagi.`);
  }

  if (!isWhatsAppConnected || !whatsappSock) {
    return ctx.reply('❌ belum ada sender terdaftar!\n\nuntuk mulai menggunakan bot, Anda harus menambahkan dan menghubungkan sender WhatsApp.\n\nSilakan pairing menggunakan perintah:\n👉 /getpairing <nomor_whatsapp>');
  }

  const messageText = ctx.message.text;
  const numbersText = messageText.replace('/cekrepe', '').trim();
  const numbers = numbersText.split(/[\s,\n]+/).filter(num => num.length > 0);
  
  if (numbers.length === 0) {
    return ctx.reply('❌ Format: /cekrepe <nomor1> <nomor2> ...\n\n💡 Maksimal 300 nomor per request');
  }

  const validNumbers = numbers.slice(0, 300).map(num => {
    let cleanNum = num.replace(/\D/g, '');
    if (cleanNum.startsWith('0')) {
      cleanNum = '62' + cleanNum.substring(1);
    } else if (cleanNum.startsWith('8')) {
      cleanNum = '62' + cleanNum;
    }
    return cleanNum;
  }).filter(num => num.length >= 10 && num.length <= 15);

  if (validNumbers.length === 0) {
    return ctx.reply('❌ Tidak ada nomor yang valid.');
  }

  try {
    // Animasi mengetik
    await ctx.telegram.sendChatAction(ctx.message.chat.id, 'typing');
    
    const progressMessage = await ctx.reply(`⏳ Memulai pengecekan nokos repe 0/${validNumbers.length} nomor...`);
    
    const registeredRepe = [];
    const notRegisteredRepe = [];
    const notRepeNumbers = {
      registered: [],
      notRegistered: []
    };

    const batchSize = 20;
    
    for (let i = 0; i < validNumbers.length; i += batchSize) {
      const batch = validNumbers.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (num) => {
        try {
          const jid = num + "@s.whatsapp.net";
          const [waCheck] = await whatsappSock.onWhatsApp(jid);
          const isRepe = isRepeNumber(num);
          
          if (waCheck && waCheck.exists) {
            if (isRepe) {
              return { num, status: 'registered_repe', repe: true };
            } else {
              return { num, status: 'registered_normal', repe: false };
            }
          } else {
            if (isRepe) {
              return { num, status: 'not_registered_repe', repe: true };
            } else {
              return { num, status: 'not_registered_normal', repe: false };
            }
          }
        } catch (e) {
          return { num, status: 'error', repe: false };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      
      batchResults.forEach(result => {
        if (result.status === 'registered_repe') {
          registeredRepe.push({ number: result.num, percentage: getVerificationPercentage(result.num) });
        } else if (result.status === 'not_registered_repe') {
          notRegisteredRepe.push(result.num);
        } else if (result.status === 'registered_normal') {
          notRepeNumbers.registered.push(result.num);
        } else if (result.status === 'not_registered_normal') {
          notRepeNumbers.notRegistered.push(result.num);
        }
      });

      const processed = Math.min(i + batchSize, validNumbers.length);
      try {
        await ctx.telegram.editMessageText(
          ctx.message.chat.id,
          progressMessage.message_id,
          null,
          `⏳ Memeriksa ${processed}/${validNumbers.length} nomor...`
        );
      } catch (e) {}

      if (i + batchSize < validNumbers.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    const filename = createRepeResultFile(registeredRepe, notRegisteredRepe, notRepeNumbers);

    await ctx.replyWithDocument(
      { source: filename },
      {
        caption: `📋 *HASIL CEK NOKOS REPE*\n\n` +
                `📊 Total: ${validNumbers.length} nomor\n` +
                `🔢 Nokos Repe Terdaftar: ${registeredRepe.length}\n` +
                `🔢 Nokos Repe Tidak Terdaftar: ${notRegisteredRepe.length}\n` +
                `📱 Nomor Biasa Terdaftar: ${notRepeNumbers.registered.length}\n` +
                `📱 Nomor Biasa Tidak Terdaftar: ${notRepeNumbers.notRegistered.length}\n\n` +
                `🕒 ${new Date().toLocaleString('id-ID')}`,
        parse_mode: 'Markdown'
      }
    );

    try {
      await ctx.telegram.deleteMessage(ctx.message.chat.id, progressMessage.message_id);
    } catch (e) {}
    
    setTimeout(() => {
      try {
        fs.unlinkSync(filename);
      } catch (e) {
        console.log('Gagal menghapus file temporary:', e.message);
      }
    }, 5000);

  } catch (error) {
    console.error('Error dalam command cekrepe:', error);
    ctx.reply('❌ Terjadi kesalahan sistem.');
  }
});

// ========== COMMAND /INFO ==========
bot.command("info", async (ctx) => {
  try {
    // TARGET USER (reply / tag / sendiri)
    let user =
      ctx.message.reply_to_message?.from ||
      (ctx.message.entities && ctx.message.entities[1]?.user) ||
      ctx.from;

    if (!user) return ctx.reply("❌ Tidak dapat mengambil data user.");

    // INFORMASI USER
    const fullname = `${user.first_name || ""} ${user.last_name || ""}`.trim();
    const username = user.username ? `@${user.username}` : "-";

    // STATUS INAEV (adminIds = list admin bot kamu)
    const inaevRank = adminIds.includes(user.id)
      ? "Admin INAEV"
      : "Member INAEV";

    // TEMPLATE PREMIUM CLEAN BOX
    const msg = `
┌── *INAEV USER INFO* ──┐

— *Nama* : ${fullname}
— *Username* : ${username}
— *ID* : ${user.id}
— *Profil* : [Intip](tg://user?id=${user.id})
• *Status INAEV* : ${inaevRank}

└── *Scan by INAEVBOT* ──┘`;

    await ctx.reply(msg, { parse_mode: "Markdown" });

  } catch (err) {
    console.error(err);
    ctx.reply("❌ Terjadi kesalahan saat mengambil info user.");
  }
});

bot.command("testinfo", async (ctx) => {
  try {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    const member = await ctx.telegram.getChatMember(chatId, userId);

    return ctx.reply(
      `🟩 *Bot BERHASIL mengambil info member!*\n\n` +
      `Status: ${member.status}\n` +
      `User: ${ctx.from.first_name}`,
      { parse_mode: "Markdown" }
    );
  } catch(e) {
    return ctx.reply(
      `❌ *GAGAL mengambil info user!*\n` +
      `Reason: ${e.description || e.message}`,
      { parse_mode: "Markdown" }
    );
  }
});

// Handler untuk new chat members
bot.on('new_chat_members', async (ctx) => {
  const chatId = ctx.message.chat.id;
  const newMembers = ctx.message.new_chat_members;

  if (chatId === VERIFICATION_GROUP_ID) {
    for (const member of newMembers) {
      const memberId = member.id;
      if (!allowedIds.includes(memberId) && !isAdmin(memberId)) {
        allowedIds.push(memberId);
        saveAllowed();
        
        try {
          await ctx.reply(
            `Selamat datang @${member.username || member.first_name}! 🎉\n` +
            `Kamu sekarang sudah terverifikasi dan bisa menggunakan semua fitur bot.`
          );
        } catch (e) {
          console.error('Gagal kirim pesan welcome:', e);
        }
      }
    }
  }
});

// Handler error bot Telegram
bot.catch((error, ctx) => {
  console.error('❌ Error Telegram Bot:', error);
  try {
    ctx.reply('❌ Terjadi kesalahan sistem. Silakan coba lagi.').catch(e => {
      console.error('Gagal kirim pesan error:', e);
    });
  } catch (e) {
    // Ignore errors in error handler
  }
});

// Start semua services
async function startAll() {
  try {
    console.log('🚀 Starting Telegram + WhatsApp Bot...');
    
    // Inisialisasi database
    initAllDb();
    
    // Load data pertama kali
    loadOwners();
    
    // Start WhatsApp connection in background
    startWhatsApp().catch(error => {
      console.error('Gagal start WhatsApp:', error);
    });
    
    await console.log('⚡[InaevBOT!!] — Bot by InaevBOT!! is now running...');
bot.launch();
    console.log('✅ Telegram Bot berhasil dijalankan');
    
    // Kirim notifikasi BOT ACTIVE ke OWNER_ID
    try {
  const date = new Date().toLocaleString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const msg =
`╔════════════════════════════╗
║ 🤖 *BOT STATUS*  
╠════════════════════════════╣
║ 📅 *Tanggal:* ${date}
║ ⚡ *Status:* Online & Aktif
╠════════════════════════════╣
║ 👑 *Owner:* ${OWNER_ID}
║ 🔓 *Akses:* Full Control
╚════════════════════════════╝`;

  await bot.telegram.sendMessage(OWNER_ID, msg, { parse_mode: "Markdown" });

} catch (error) {
  console.error("Gagal kirim notifikasi ke owner:", error);
}
    
    console.log('\n📋 BOT INFORMATION:');
    console.log('• WhatsApp: ' + (isWhatsAppConnected ? 'Connected' : 'Connecting...'));
    console.log('• Telegram: Connected');
    console.log('• Owner ID:', OWNER_ID);
    console.log('• Admin Count:', adminIds.length);
    console.log('• Allowed Users:', allowedIds.length);
    console.log('• Cooldown: 1000 detik GLOBAL untuk semua command');
    console.log('• Max Numbers: 300 per command (kecuali /cekbiofile)');
    console.log('• Fitur Baru: /fix (banding WhatsApp dengan template MT)');
    console.log('• Fitur Baru: Meta Business & Persentase Jam di /cekbio & /cekbiofile');
    console.log('• Auto-reconnect: Aktif');
    console.log('• QR Code System: WhatsApp Web JS Style');
    console.log('• Pairing Code System: Support semua negara');
    console.log('• File Support: TXT, CSV, XLSX untuk /cekbiofile');
    console.log('• Batch Size: 20 untuk semua command');
    console.log('• Gunakan /start di bot Telegram untuk mulai');
    
  } catch (error) {
    console.error('❌ Gagal memulai bot:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('\n🛑 Shutting down bot...');
  bot.stop();
  if (whatsappSock) whatsappSock.end();
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('\n🛑 Shutting down bot...');
  bot.stop();
  if (whatsappSock) whatsappSock.end();
  process.exit(0);
});

// Start the bot
startAll();

// ========== COMMAND /RESTARTPANEL ==========
bot.command('restartpanel', async (ctx) => {
  const userId = ctx.message.from.id;

  // Only Owner, Admin, or Premium allowed
  const isAllowedRestart =
    isOwner(userId) || isAdmin(userId) || isPremium(userId);

  if (!isAllowedRestart) {
    return ctx.reply('❌ Hanya Owner, Admin, atau Premium yang bisa menggunakan perintah ini.');
  }

  await ctx.reply('🔄 Panel sedang direstart dan session WhatsApp dihapus...');

  try {
    // Hapus folder auth biar pairing ulang nanti
    if (fs.existsSync('./auth')) {
      try {
        fs.rmSync('./auth', { recursive: true, force: true });
        console.log('🗑️ Folder auth dihapus.');
      } catch (err) {
        console.error('Gagal hapus ./auth:', err);
      }
    }

    // Tutup koneksi WhatsApp dengan aman
    if (whatsappSock && typeof whatsappSock.logout === 'function') {
      try {
        await whatsappSock.logout();
      } catch (e) {
        console.warn('Error saat logout whatsappSock:', e);
      }
    }
    try {
      if (whatsappSock && typeof whatsappSock.end === 'function') {
        whatsappSock.end();
      }
    } catch (e) {
      // ignore
    }
    whatsappSock = null;
    isWhatsAppConnected = false;

    // Tunggu sedikit lalu restart process agar panel auto-restart (PM2/Replit/Railway etc.)
    setTimeout(() => {
      console.log('🔁 Exiting process for panel to restart...');
      process.exit(1);
    }, 1500);

  } catch (error) {
    console.error('❌ Gagal restart panel:', error);
    await ctx.reply('❌ Terjadi kesalahan saat restart panel.');
  }
});


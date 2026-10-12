// 1ファイルだけを入れる最小の ZIP ライター（無圧縮 / STORE）。WAV・MP3 は元々圧縮済み or 圧縮効果が薄いので十分。

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** @param {string} name ZIP内のファイル名(UTF-8)  @param {Uint8Array} data  @returns {Blob} */
export function zipSingle(name, data, date = new Date()) {
  const nameBytes = new TextEncoder().encode(name);
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const crc = crc32(data), size = data.length;

  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); // UTF-8 名
  local.setUint16(8, 0, true); local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true);
  local.setUint32(14, crc, true); local.setUint32(18, size, true); local.setUint32(22, size, true);
  local.setUint16(26, nameBytes.length, true); local.setUint16(28, 0, true);

  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true); central.setUint16(8, 0x0800, true);
  central.setUint16(10, 0, true); central.setUint16(12, dosTime, true); central.setUint16(14, dosDate, true);
  central.setUint32(16, crc, true); central.setUint32(20, size, true); central.setUint32(24, size, true);
  central.setUint16(28, nameBytes.length, true); // 以降(extra/comment/disk/attrs/offset)は 0

  const localLen = 30 + nameBytes.length + size, centralLen = 46 + nameBytes.length;
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, 1, true); eocd.setUint16(10, 1, true);
  eocd.setUint32(12, centralLen, true); eocd.setUint32(16, localLen, true);

  return new Blob([local, nameBytes, data, central, nameBytes, eocd], { type: 'application/zip' });
}

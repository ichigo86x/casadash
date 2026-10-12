import QRCode from 'qrcode';
import * as o from 'otpauth';

console.log("QRCode library keys:", Object.keys(QRCode));
if (QRCode.toDataURL) {
    QRCode.toDataURL('otpauth://totp/a?secret=b').then(res => console.log("SUCCESS length:", res.length)).catch(e => console.error("ERR:", e));
} else {
    console.log("QRCode.toDataURL missing!");
}

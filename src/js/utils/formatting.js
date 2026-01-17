/**
 * Data formatting utilities
 */

export function formatBytes(bytes) {
    if (bytes == null) return "";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0, n = bytes;
    while (n >= 1024 && i < u.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n.toFixed(1)} ${u[i]}`;
}

export const fmtMs = (ms) => `${ms.toFixed(1)} ms`;

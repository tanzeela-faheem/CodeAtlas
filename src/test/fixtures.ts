import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
export async function fixture(files: Record<string, string> = { "src/app.js": "export const x = 1;" }) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeatlas-test-"));
    const source = path.join(root, "input");
    await fs.mkdir(source);
    for (const [name, content] of Object.entries(files)) {
        await fs.mkdir(path.dirname(path.join(source, name)), { recursive: true });
        await fs.writeFile(path.join(source, name), content);
    }
    return {
        root,
        source,
        storage: path.join(root, "workspaces"),
        cleanup: () => fs.rm(root, { recursive: true, force: true })
    };
}
// Minimal stored ZIP generator, for controlled test inputs only.
export function zip(entries: Record<string, string>): Buffer {
    const locals: Buffer[] = [],
        central: Buffer[] = [];
    let offset = 0;
    for (const [name, text] of Object.entries(entries)) {
        const data = Buffer.from(text),
            filename = Buffer.from(name);
        let crc = 0xffffffff;
        for (const byte of data) {
            crc ^= byte;
            for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
        crc = (crc ^ 0xffffffff) >>> 0;
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50);
        local.writeUInt16LE(20, 4);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(filename.length, 26);
        locals.push(local, filename, data);
        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50);
        cd.writeUInt16LE(20, 4);
        cd.writeUInt16LE(20, 6);
        cd.writeUInt32LE(crc, 16);
        cd.writeUInt32LE(data.length, 20);
        cd.writeUInt32LE(data.length, 24);
        cd.writeUInt16LE(filename.length, 28);
        cd.writeUInt32LE(offset, 42);
        central.push(cd, filename);
        offset += local.length + filename.length + data.length;
    }
    const directory = Buffer.concat(central),
        end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(Object.keys(entries).length, 8);
    end.writeUInt16LE(Object.keys(entries).length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}

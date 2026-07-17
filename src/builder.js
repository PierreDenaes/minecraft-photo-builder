const { optimizeToCommands } = require('./optimizer');

const TICK_MS = 50;
const CMDS_PER_TICK = 2;

class Builder {
  constructor(bot, { maxBlocks }) {
    this.bot = bot;
    this.maxBlocks = maxBlocks;
    this.queue = [];
    this.timer = null;
    this.snapshot = null;
    this.progress = { active: false, done: 0, total: 0 };
  }

  computeOrigin(playerPos, yaw, size) {
    // Direction cardinale dominante du regard (convention mineflayer : x = -sin(yaw), z = -cos(yaw))
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    const px = Math.floor(playerPos.x);
    const pz = Math.floor(playerPos.z);
    const y = Math.floor(playerPos.y);
    if (Math.abs(dx) > Math.abs(dz)) {
      const sign = Math.sign(dx);
      return {
        x: sign > 0 ? px + 5 : px - 5 - (size.x - 1),
        y,
        z: pz - Math.floor(size.z / 2)
      };
    }
    const sign = Math.sign(dz) || -1;
    return {
      x: px - Math.floor(size.x / 2),
      y,
      z: sign > 0 ? pz + 5 : pz - 5 - (size.z - 1)
    };
  }

  flattenCommands(origin, size) {
    const x1 = origin.x - 1, x2 = origin.x + size.x;
    const z1 = origin.z - 1, z2 = origin.z + size.z;
    const cmds = [`/fill ${x1} ${origin.y - 1} ${z1} ${x2} ${origin.y - 1} ${z2} dirt`];
    for (let y = origin.y; y < origin.y + size.y; y++) {
      cmds.push(`/fill ${x1} ${y} ${z1} ${x2} ${y} ${z2} air`);
    }
    return cmds;
  }

  takeSnapshot(origin, size) {
    const volume = (size.x + 2) * (size.y + 1) * (size.z + 2);
    if (volume > this.maxBlocks) return null;
    const saved = [];
    for (let x = origin.x - 1; x <= origin.x + size.x; x++) {
      for (let y = origin.y - 1; y < origin.y + size.y; y++) {
        for (let z = origin.z - 1; z <= origin.z + size.z; z++) {
          const block = this.bot.blockAt({ x, y, z });
          saved.push({ x: x - origin.x + 1, y: y - origin.y + 1, z: z - origin.z + 1, block: block ? block.name : 'air' });
        }
      }
    }
    return { origin: { x: origin.x - 1, y: origin.y - 1, z: origin.z - 1 }, blocks: saved };
  }

  startBuild(blocks, origin, size) {
    this.snapshot = this.takeSnapshot(origin, size);
    const cmds = [
      ...this.flattenCommands(origin, size),
      ...optimizeToCommands(blocks, origin)
    ];
    this.enqueue(cmds);
    return { total: cmds.length };
  }

  undo() {
    if (!this.snapshot) return false;
    // Restaurer : d'abord tout vider (air) par couches, puis reposer les blocs sauvegardés non-air
    const cmds = [
      ...this.flattenCommandsFromSnapshot(),
      ...optimizeToCommands(this.snapshot.blocks, this.snapshot.origin)
    ];
    this.snapshot = null;
    this.enqueue(cmds);
    return true;
  }

  flattenCommandsFromSnapshot() {
    const s = this.snapshot;
    let max = { x: 0, y: 0, z: 0 };
    for (const b of s.blocks) {
      max = { x: Math.max(max.x, b.x), y: Math.max(max.y, b.y), z: Math.max(max.z, b.z) };
    }
    const cmds = [];
    for (let y = 0; y <= max.y; y++) {
      cmds.push(`/fill ${s.origin.x} ${s.origin.y + y} ${s.origin.z} ${s.origin.x + max.x} ${s.origin.y + y} ${s.origin.z + max.z} air`);
    }
    return cmds;
  }

  enqueue(cmds) {
    this.queue.push(...cmds);
    this.progress = { active: true, done: 0, total: this.queue.length };
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (let i = 0; i < CMDS_PER_TICK && this.queue.length > 0; i++) {
        this.bot.chat(this.queue.shift());
        this.progress.done++;
      }
      if (this.queue.length === 0) {
        clearInterval(this.timer);
        this.timer = null;
        this.progress.active = false;
      }
    }, TICK_MS);
  }

  status() {
    return { ...this.progress };
  }

  estimateSeconds(totalCommands) {
    return Math.ceil((totalCommands / CMDS_PER_TICK) * TICK_MS / 1000);
  }
}

module.exports = { Builder };

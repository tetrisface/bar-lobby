// SPDX-FileCopyrightText: 2025 The BAR Lobby Authors
//
// SPDX-License-Identifier: MIT

import { promises as fs } from "fs";
import fsSync from "fs";
import path from "path";
import { createHash } from "crypto";
import { logger } from "@main/utils/logger";

const log = logger("delta-baking.service.ts");
import { ModMetadata } from "./mod-types";
import { WRITE_DATA_PATH } from "@main/config/app";

export interface DeltaBakingOptions {
    baseGameType: string;
    mods: ModMetadata[];
    engineVersion: string;
}

export interface BakedGameResult {
    gameType: string;
    archivePath: string;
    hash: string;
}

/**
 * Service for baking delta mods into a single game archive.
 * This combines a base game with mod overlays to create a unified game.
 */
export class DeltaBakingService {
    private readonly bakedGamesDir = path.join(WRITE_DATA_PATH, "baked-games");

    constructor() {
        // Create directory synchronously to avoid async constructor issues
        this.ensureBakedGamesDirSync();
    }

    private ensureBakedGamesDirSync(): void {
        try {
            fsSync.mkdirSync(this.bakedGamesDir, { recursive: true });
        } catch (error) {
            log.error("Failed to create baked games directory:", error);
        }
    }

    /**
     * Bakes a base game with mod deltas into a single game archive.
     */
    async bakeGame(options: DeltaBakingOptions): Promise<BakedGameResult> {
        const { baseGameType, mods, engineVersion } = options;

        log.info(`🏗️ Starting delta baking for base game: ${baseGameType} with ${mods.length} mods`);

        // Generate hash for this combination
        const combinationHash = this.generateCombinationHash(baseGameType, mods, engineVersion);
        const bakedGameName = `baked-${combinationHash}`;
        const bakedGameDir = path.join(this.bakedGamesDir, bakedGameName);
        const bakedGameArchive = `${bakedGameDir}.sdd`;

        // Check if already baked
        if (await this.fileExists(bakedGameArchive)) {
            log.info(`✅ Found existing baked game: ${bakedGameName}`);
            return {
                gameType: bakedGameName,
                archivePath: bakedGameArchive,
                hash: combinationHash,
            };
        }

        log.info(`🔨 Baking new game combination: ${bakedGameName}`);

        try {
            // Step 1: Find and extract base game
            const baseGamePath = await this.findBaseGame(baseGameType, engineVersion);
            await this.extractArchive(baseGamePath, bakedGameDir);

            // Step 2: Apply mod deltas in order
            for (const mod of mods) {
                log.info(`📦 Applying mod delta: ${mod.name}`);
                await this.applyModDelta(mod, bakedGameDir);
            }

            // Step 3: Create modinfo.lua for the baked game
            await this.createBakedGameModInfo(bakedGameDir, baseGameType, mods);

            // Step 4: Package as .sdd directory (Spring recognizes .sdd as archives)
            // No need to zip - Spring can read .sdd directories directly

            log.info(`✅ Successfully baked game: ${bakedGameName}`);

            return {
                gameType: bakedGameName,
                archivePath: bakedGameArchive,
                hash: combinationHash,
            };
        } catch (error) {
            log.error(`❌ Failed to bake game:`, error);
            // Cleanup on failure
            await this.cleanupBakedGame(bakedGameDir);
            throw error;
        }
    }

    /**
     * Generates a hash for the base game + mods combination.
     */
    private generateCombinationHash(baseGameType: string, mods: ModMetadata[], engineVersion: string): string {
        const content = JSON.stringify({
            baseGameType,
            engineVersion,
            mods: mods.map((mod) => ({
                shortname: mod.shortname,
                version: mod.version,
                installPath: mod.installPath,
            })),
        });

        return createHash("sha256").update(content).digest("hex").substring(0, 16);
    }

    /**
     * Finds the base game archive in the engine directories.
     */
    private async findBaseGame(gameType: string, engineVersion: string): Promise<string> {
        // For rapid-managed games, we'll need to find the actual game files
        // First, let's try to find any available base game files
        log.info(`🔍 Looking for base game files for: ${gameType}`);

        const possiblePaths = [path.join(WRITE_DATA_PATH, "games"), path.join(process.cwd(), "assets", "engine", engineVersion, "games"), path.join(process.cwd(), "assets", "games")];

        for (const searchDir of possiblePaths) {
            if (!(await this.fileExists(searchDir))) continue;

            const files = await fs.readdir(searchDir);

            // Look for archives that might contain the base game
            const candidates = files.filter((file) => file.toLowerCase().includes(gameType.toLowerCase()) || file.toLowerCase().includes("byar") || file.toLowerCase().includes("beyond"));

            for (const candidate of candidates) {
                const fullPath = path.join(searchDir, candidate);
                if (await this.isValidGameArchive(fullPath)) {
                    log.info(`📁 Found base game at: ${fullPath}`);
                    return fullPath;
                }
            }
        }

        throw new Error(`Base game not found for: ${gameType}`);
    }

    /**
     * Checks if a path is a valid game archive.
     */
    private async isValidGameArchive(archivePath: string): Promise<boolean> {
        try {
            const stat = await fs.stat(archivePath);

            // Check if it's a directory (.sdd) or archive (.sdz, .sd7)
            if (stat.isDirectory() && archivePath.endsWith(".sdd")) {
                return await this.fileExists(path.join(archivePath, "modinfo.lua"));
            }

            // For now, assume zip files are valid (we'd need to peek inside)
            if (stat.isFile() && (archivePath.endsWith(".sdz") || archivePath.endsWith(".sd7"))) {
                return true;
            }

            return false;
        } catch {
            return false;
        }
    }

    /**
     * Extracts an archive to a destination directory.
     */
    private async extractArchive(archivePath: string, destDir: string): Promise<void> {
        const stat = await fs.stat(archivePath);

        if (stat.isDirectory()) {
            // It's already a directory (.sdd), just copy it
            log.info(`📂 Copying directory: ${archivePath} -> ${destDir}`);
            await fs.cp(archivePath, destDir, { recursive: true });
        } else {
            // It's a zip file, we'd need to extract it
            // For now, throw an error - we can implement zip extraction later
            throw new Error(`Zip extraction not yet implemented for: ${archivePath}`);
        }
    }

    /**
     * Applies a mod's delta changes to the baked game directory.
     */
    private async applyModDelta(mod: ModMetadata, bakedGameDir: string): Promise<void> {
        const modPath = mod.installPath;

        // Copy mod files over base game files (overlay approach)
        log.info(`🔄 Overlaying mod files from: ${modPath}`);

        await this.overlayDirectory(modPath, bakedGameDir);
    }

    /**
     * Overlays source directory onto destination directory.
     */
    private async overlayDirectory(srcDir: string, destDir: string): Promise<void> {
        const entries = await fs.readdir(srcDir, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(srcDir, entry.name);
            const destPath = path.join(destDir, entry.name);

            if (entry.isDirectory()) {
                // Ensure destination directory exists
                await fs.mkdir(destPath, { recursive: true });
                // Recursively overlay subdirectory
                await this.overlayDirectory(srcPath, destPath);
            } else {
                // Copy file (overwrites if exists)
                await fs.copyFile(srcPath, destPath);
                log.debug(`📄 Overlaid file: ${entry.name}`);
            }
        }
    }

    /**
     * Creates a modinfo.lua for the baked game.
     */
    private async createBakedGameModInfo(bakedGameDir: string, baseGameType: string, mods: ModMetadata[]): Promise<void> {
        const modInfoPath = path.join(bakedGameDir, "modinfo.lua");

        const modNames = mods.map((mod) => mod.name).join(" + ");
        const shortname = `baked-${this.generateCombinationHash(baseGameType, mods, "").substring(0, 8)}`;

        const modInfoContent = `return {
    name='${baseGameType} + ${modNames}',
    description='Baked game combining ${baseGameType} with ${mods.length} mod(s)',
    version='baked-1.0.0',
    shortname='${shortname}',
    game='Beyond All Reason',
    shortGame='BAR',
    modtype=1, -- Game type
    depend = {
        -- Base game dependencies inherited
    }
}`;

        await fs.writeFile(modInfoPath, modInfoContent, "utf-8");
        log.info(`📝 Created baked game modinfo.lua`);
    }

    /**
     * Cleans up a failed baking attempt.
     */
    private async cleanupBakedGame(bakedGameDir: string): Promise<void> {
        try {
            if (await this.fileExists(bakedGameDir)) {
                await fs.rm(bakedGameDir, { recursive: true, force: true });
                log.info(`🧹 Cleaned up failed baking attempt: ${bakedGameDir}`);
            }
        } catch (error) {
            log.warn(`Failed to cleanup baked game directory:`, error);
        }
    }

    /**
     * Utility to check if file/directory exists.
     */
    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Cleans up old baked games to save disk space.
     */
    async cleanupOldBakedGames(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
        try {
            if (!(await this.fileExists(this.bakedGamesDir))) return;

            const entries = await fs.readdir(this.bakedGamesDir, { withFileTypes: true });
            const now = Date.now();

            for (const entry of entries) {
                if (entry.isDirectory() && entry.name.startsWith("baked-")) {
                    const entryPath = path.join(this.bakedGamesDir, entry.name);
                    const stat = await fs.stat(entryPath);

                    if (now - stat.mtime.getTime() > maxAge) {
                        await fs.rm(entryPath, { recursive: true, force: true });
                        log.info(`🧹 Cleaned up old baked game: ${entry.name}`);
                    }
                }
            }
        } catch (error) {
            log.warn("Failed to cleanup old baked games:", error);
        }
    }
}

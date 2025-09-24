// SPDX-FileCopyrightText: 2025 The BAR Lobby Authors
//
// SPDX-License-Identifier: MIT

import { computed, type Ref } from "vue";
import { ModMetadata } from "@main/content/mods/mod-types";
import { BakedGameResult } from "@main/content/mods/delta-baking.service";

export interface ModIntegrationOptions {
    selectedMods: Ref<ModMetadata[]>;
}

export interface ModIntegrationReturn {
    modPaths: Ref<string[]>;
    modScriptContent: Ref<string>;
    hasMods: Ref<boolean>;
    generateModScriptContent: () => string;
    injectModsIntoScript: (script: string) => string;
    bakeGameWithMods: (baseGameType: string, engineVersion: string) => Promise<BakedGameResult>;
}

/**
 * Composable for integrating mod selection with scenario launches.
 * Handles the conversion of selected mods into Spring engine compatible formats.
 */
export function useModIntegration(options: ModIntegrationOptions): ModIntegrationReturn {
    const { selectedMods } = options;

    // Computed properties
    const modPaths = computed(() => {
        return selectedMods.value.map((mod) => mod.installPath);
    });

    const hasMods = computed(() => {
        return selectedMods.value.length > 0;
    });

    const modScriptContent = computed(() => {
        return generateModScriptContent();
    });

    /**
     * Generates Spring engine compatible mod script content.
     * This includes MUTATOR sections and mod-specific configuration.
     */
    function generateModScriptContent(): string {
        if (!hasMods.value) {
            return "";
        }

        let scriptContent = "";

        // Add MUTATOR sections for each mod
        selectedMods.value.forEach((mod, index) => {
            // Extract the archive name from the install path
            const pathParts = mod.installPath.split(/[/\\]/);
            const archiveName = pathParts[pathParts.length - 1];

            scriptContent += `\n[MUTATOR${index}]\n`;
            scriptContent += `{\n`;
            scriptContent += `    Name=${mod.shortname};\n`;
            scriptContent += `    Archive=${archiveName};\n`;
            scriptContent += `}\n`;
        });

        return scriptContent;
    }

    /**
     * Injects mod content into a Spring script at the appropriate location.
     * This method finds the right place to insert mod sections in the script.
     */
    function injectModsIntoScript(script: string): string {
        if (!hasMods.value) {
            return script;
        }

        // 🎯 ENABLED: GameType approach for single mods
        if (selectedMods.value.length === 1) {
            const mod = selectedMods.value[0];

            // Extract archive name from install path
            const pathParts = mod.installPath.split(/[/\\]/);
            const archiveName = pathParts[pathParts.length - 1]; // e.g., modtest3-scenario.sdd

            console.log(`🎯 Using GameType approach - setting gametype = ${archiveName}`);

            // Replace the gametype line with our mod archive
            const modifiedScript = script.replace(/gametype\s*=\s*[^;\n\r]+[;\n\r]/i, `gametype = ${archiveName};\n`);

            return modifiedScript;
        }

        // For multiple mods, we still need delta baking (not implemented yet)
        console.log(`⚠️ Multiple mods selected - GameType approach only works for single mods`);
        return script;
    }

    /**
     * Bakes the selected mods with a base game into a single game archive.
     */
    async function bakeGameWithMods(baseGameType: string, engineVersion: string): Promise<BakedGameResult> {
        if (!hasMods.value) {
            throw new Error("No mods selected for baking");
        }

        const modIds = selectedMods.value.map((mod) => mod.id);
        console.log(`🏗️ Baking game: ${baseGameType} with mods: ${modIds.join(", ")}`);

        return await window.mod.bakeGameWithMods(baseGameType, modIds, engineVersion);
    }

    return {
        modPaths,
        modScriptContent,
        hasMods,
        generateModScriptContent,
        injectModsIntoScript,
        bakeGameWithMods,
    };
}

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";

import { type Oklch, interpolate, oklch } from "culori";

import variables from "daisyui/functions/variables.js";
import { allThemes } from "./colors";

const colorNames = variables.colors;

type CssInJs = {
	[x: string]: unknown;
};

const getDaisyUIObjects = async (type: string) => {
	const req = createRequire(import.meta.url);
	const path = resolve(dirname(req.resolve("daisyui")), type);
	const content: Record<string, CssInJs> = {};

	for (const file of await fs.readdir(path, {
		recursive: true,
	})) {
		const filePath = resolve(path, file.toString());

		if (basename(filePath) === "object.js") {
			const name = basename(dirname(filePath));

			// vite-ignore should be fine here
			content[name] = (await import(/* @vite-ignore */ filePath))
				.default as CssInJs;
		}
	}

	return content;
};

const colorObjToString = (colorObj: Oklch) =>
	`${colorObj.l} ${colorObj.c} ${colorObj.h}`;

const generateDarkenColorFrom = (input: string, percentage = 0.07) => {
	try {
		const result = interpolate([input, "black"], "oklch")(percentage);
		return colorObjToString(result);
	} catch {
		return false;
	}
};
const isDark = (color: string) => {
	const [l] = color.split(" ").map((n) => Number.parseFloat(n)) as [number];
	return l < 50;
};

const generateForegroundColor = (
	input?: string,
	percentage = 0.8,
) => {
	if (!input) {
		return "0% 0 0";
	}

	try {
		const result = interpolate(
			[input, isDark(input) ? "white" : "black"],
			"oklch",
		)(percentage);
		return colorObjToString(result);
	} catch {
		// colorIsInvalid(input)
		return false;
	}
};

const themeDefaults = {
	themeOrder: Object.keys(allThemes),
	variables: {
		"--rounded-box": "1rem",
		"--rounded-btn": "0.5rem",
		"--rounded-badge": "1.9rem",
		"--animation-btn": "0.25s",
		"--animation-input": ".2s",
		"--btn-focus-scale": "0.95",
		"--border-btn": "1px",
		"--tab-border": "1px",
		"--tab-radius": "0.5rem",
	},
};

const convertColorFormat = (input: Record<string, string>) => {
	const resultObj: Record<string, typeof variables.colors> = {};

	for (const [rule, value] of Object.entries(input)) {
		if (rule in colorNames) {
			try {
				const colorObj = oklch(value)!;
				resultObj[colorNames[rule]] = colorObjToString(colorObj);
			} catch {
				return false;
			}
		} else {
			resultObj[rule] = value;
		}

		// auto generate base colors
		if (!("base-100" in input)) {
			resultObj["--b1"] = "100% 0 0";
		}
		if (!("base-200" in input)) {
			resultObj["--b2"] = generateDarkenColorFrom(input["base-100"]!, 0.07);
		}
		if (!("base-300" in input)) {
			if ("base-200" in input) {
				resultObj["--b3"] = generateDarkenColorFrom(input["base-200"], 0.07);
			} else {
				resultObj["--b3"] = generateDarkenColorFrom(input["base-100"]!, 0.14);
			}
		}

		// auto generate state colors
		if (!("info" in input)) {
			resultObj["--in"] = "72.06% 0.191 231.6";
		}
		if (!("success" in input)) {
			resultObj["--su"] = "64.8% 0.150 160";
		}
		if (!("warning" in input)) {
			resultObj["--wa"] = "84.71% 0.199 83.87";
		}
		if (!("error" in input)) {
			resultObj["--er"] = "71.76% 0.221 22.18";
		}

		// auto generate content colors
		if (!("base-content" in input)) {
			resultObj["--bc"] = generateForegroundColor(input["base-100"]!, 0.8);
		}
		if (!("primary-content" in input)) {
			resultObj["--pc"] = generateForegroundColor(input["primary"], 0.8);
		}
		if (!("secondary-content" in input)) {
			resultObj["--sc"] = generateForegroundColor(input["secondary"], 0.8);
		}
		if (!("accent-content" in input)) {
			resultObj["--ac"] = generateForegroundColor(input["accent"], 0.8);
		}
		if (!("neutral-content" in input)) {
			resultObj["--nc"] = generateForegroundColor(input["neutral"], 0.8);
		}
		if (!("info-content" in input)) {
			if ("info" in input) {
				resultObj["--inc"] = generateForegroundColor(input["info"], 0.8);
			} else {
				resultObj["--inc"] = "0% 0 0";
			}
		}
		if (!("success-content" in input)) {
			if ("success" in input) {
				resultObj["--suc"] = generateForegroundColor(input["success"], 0.8);
			} else {
				resultObj["--suc"] = "0% 0 0";
			}
		}
		if (!("warning-content" in input)) {
			if ("warning" in input) {
				resultObj["--wac"] = generateForegroundColor(input["warning"], 0.8);
			} else {
				resultObj["--wac"] = "0% 0 0";
			}
		}
		if (!("error-content" in input)) {
			if ("error" in input) {
				resultObj["--erc"] = generateForegroundColor(input["error"], 0.8);
			} else {
				resultObj["--erc"] = "0% 0 0";
			}
		}

		// add css variables if not exist
		for (const item of Object.entries(themeDefaults.variables)) {
			const [variable, value] = item;
			if (!(variable in input)) {
				resultObj[variable] = value;
			}
		}

		// add other custom styles
		if (!(rule in colorNames)) {
			resultObj[rule] = value;
		}
	}

	return resultObj;
};

export {
	variables,
	allThemes,
	getDaisyUIObjects,
	convertColorFormat,
	colorNames,
	themeDefaults,
};
export type { CssInJs };

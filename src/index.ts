import { CSSObjectInput, type DynamicRule, type Preflight, type Preset } from "@unocss/core";
import autoprefixer from "autoprefixer";
import camelCase from "camelcase";

import {
	type CssInJs,
	allThemes,
	convertColorFormat,
	getDaisyUIObjects,
	themeDefaults,
	variables,
} from "./utils";

import { type ClassToken, tokenize } from "parsel-js";
import postcss, { type Rule, type ChildNode, Declaration } from "postcss";
import { parse } from "postcss-js";

const processor = postcss(autoprefixer);
const process = (object: CssInJs) =>
	processor.process(object, { parser: parse });

type StringMap = Record<string, string>;

const defaultOptions = {
	styled: true,
	themes: false as
		| boolean
		| Array<string | Record<string, StringMap>>,
	base: true,
	rtl: false,
	darkTheme: "dark",
	utils: true,
	variablePrefix: "--un-",
};

const injectThemes = (
	addBase: (themes: unknown) => void,
	config: (key: string) => unknown,
	themes: Record<string, StringMap>,
) => {
	const includedThemesObj: Record<string, StringMap | false> = {};
	// add default themes
	const themeRoot = config("daisyui.themeRoot") as string ?? ":root";
	for (const theme in themes) {
		includedThemesObj[theme] = convertColorFormat(themes[theme]);
	}

	// add custom themes
	if (Array.isArray(config("daisyui.themes"))) {
		for (const item of config("daisyui.themes") as Array<
			string | Record<string, StringMap>
		>) {
			if (item && typeof item === "object") {
				for (const customThemeName in item) {
					includedThemesObj[customThemeName] = convertColorFormat(
						item[customThemeName],
					);
				}
			}
		}
	}

	let themeOrder = [];
	const newLocal = config("daisyui.themes");
	if (Array.isArray(newLocal)) {
		for (const theme of config("daisyui.themes") as Array<
			string | Record<string, StringMap>
		>) {
			if (theme && typeof theme === "object") {
				for (const customThemeName in theme) {
					themeOrder.push(customThemeName);
				}
			} else if (theme in includedThemesObj) {
				themeOrder.push(theme);
			}
		}
	} else if (config("daisyui.themes") === true) {
		themeOrder = themeDefaults.themeOrder;
	} else {
		themeOrder = ["light", "dark"];
	}

	// inject themes in order
	const themesToInject: Record<string, unknown> = {};
	themeOrder.forEach((themeName, index) => {
		if (index === 0) {
			// first theme as root
			themesToInject[themeRoot] = includedThemesObj[themeName];
		} else if (index === 1) {
			// auto dark
			if (config("daisyui.darkTheme")) {
				if (
					themeOrder[0] !== config("daisyui.darkTheme") &&
					themeOrder.includes(config("daisyui.darkTheme") as string)
				) {
					themesToInject["@media (prefers-color-scheme: dark)"] = {
						[themeRoot]: includedThemesObj[`${config("daisyui.darkTheme")}`],
					};
				}
			} else if (config("daisyui.darkTheme") === false) {
				// disables prefers-color-scheme: dark
			} else {
				if (themeOrder[0] !== "dark" && themeOrder.includes("dark")) {
					themesToInject["@media (prefers-color-scheme: dark)"] = {
						[themeRoot]: includedThemesObj["dark"],
					};
				}
			}
			// theme 0 with name
			themesToInject[`[data-theme=${themeOrder[0]}]`] =
				includedThemesObj[themeOrder[0]!];
			themesToInject[
				`${themeRoot}:has(input.theme-controller[value=${themeOrder[0]}]:checked)`
			] = includedThemesObj[themeOrder[0]!];
			// theme 1 with name
			themesToInject[`[data-theme=${themeOrder[1]}]`] =
				includedThemesObj[themeOrder[1]!];
			themesToInject[
				`${themeRoot}:has(input.theme-controller[value=${themeOrder[1]}]:checked)`
			] = includedThemesObj[themeOrder[1]!];
		} else {
			themesToInject[`[data-theme=${themeName}]`] =
				includedThemesObj[themeName];
			themesToInject[
				`${themeRoot}:has(input.theme-controller[value=${themeName}]:checked)`
			] = includedThemesObj[themeName];
		}
	});

	addBase(themesToInject);

	return {
		includedThemesObj,
		themeOrder,
	};
};

function* flattenRules(nodes: ChildNode[], parents: string[] = []): Generator<[string[], string, Declaration[]] | string> {
	for (const node of nodes) {
		if (node.type === 'comment') {
			continue;
		}
		if (node.type === 'rule') {
			const declarations = node.nodes.filter(({ type }) => type === 'decl') as Declaration[];
			if (declarations.length !== node.nodes.filter(({ type }) => type !== 'comment').length) {
				throw new Error('unexpected mixed declarations node');
			}
			if (declarations.length) {
				node.nodes = declarations;
				yield [parents, node.selector, declarations];
			}
		} else if (node.type === 'atrule') {
			if (node.nodes == null || node.nodes.length === 0) {
				continue;
			}
			if (node.name === 'keyframes') {
				yield node.toString();
			} else {
				yield* flattenRules(node.nodes, [...parents, `@${node.name}${node.raws.afterName ?? ' '}${node.params ?? ''}`]);
			}
		} else {
			// eslint-disable-next-line no-console
			console.warn('skipping', node.type);
		}
	}
}

const CSSCLASS = /\.(?<name>[-\w\P{ASCII}]+)/gu;

function getUnoCssElements(childNodes: ChildNode[], cssObjInputsByClassToken: Map<string, CSSObjectInput[]>, layer?: string): Preflight[] {
	const preflights: Preflight[] = [];
	let i = 0;
	for (const rawElement of flattenRules(childNodes)) {
		i++;
		if (typeof rawElement === 'string') {
			preflights.push({
				getCSS: () => rawElement,
				layer
			});
			continue;
		}
		const [parents, selector, declarations] = rawElement,
			classTokens = new Set(Array.from(selector.matchAll(CSSCLASS).map(([, name]) => name)));

		if (classTokens.size === 0) {
			throw new Error('why include this rule?');
		}

		/*for (const classToken of classTokens) {
			let cssObjInputs = cssObjInputsByClassToken.get(classToken);
			if (cssObjInputs == null) {
				cssObjInputs = [];
				cssObjInputsByClassToken.set(classToken, cssObjInputs);
			}
			cssObjInputs.push({
				...Object.fromEntries((declarations).map(({ important, prop, value }) => [prop, `${value}${important ? ' !important' : ''}`])),
				[symbols.layer]: layer,
				[symbols.parent]: parents.join(' $$ '),
				[symbols.selector]: (currentSelector: string) =>
					selector === currentSelector
						? selector
						: selector.replaceAll(CSSCLASS, (all, c) => {
							return c === classToken ? currentSelector : all;
						}),
				[symbols.sort]: i - 1
			});
		}*/
	}
	return preflights;
}

export const presetDaisy = async (
	o: Partial<typeof defaultOptions> = {},
): Promise<Preset> => {
	const options = { ...defaultOptions, ...o };
	const replacePrefix = (css: string) => css.replaceAll("--tw-", options.variablePrefix);

	const rules = new Map<string, string>();
	/*const specialRules: Record<string, string[]> = {
		keyframes: [],
		supports: [],
	};*/
	const nodes: Rule[] = [];

	const components = await getDaisyUIObjects("components");
	// const styles = [options.styled ? styled : unstyled];
	const styles = options.styled ? Object.values(components) : [];
	// console.log(styles)
	// if (options.utils) {
	// 	styles.push(...Object.values(utilities));
	// }

	/*
	const categorizeRules = (node: ChildNode) => {
		if (node.type === "rule") {
			nodes.push(node);
		} else if (node.type === "atrule") {
			if (Array.isArray(specialRules[node.name])) {
				specialRules[node.name].push(String(node));
			} else if (node.nodes) {
				// ignore and keep traversing, e.g. for @media
				for (const child of node.nodes) {
					categorizeRules(child);
				}
			}
		}
	};

	for (const style of styles) {
		const root = process(style).root;

		for (const node of root.nodes as ChildNode[]) {
			categorizeRules(node);
		}
	}
	*/

	for (const node of nodes) {
		const selector = node.selectors[0];
		const tokens = tokenize(selector);
		const token = tokens[0];
		let base = "";

		if (token.type === "class") {
			// Resolve conflicts with @unocss/preset-wind link variant
			// .link-* -> .link
			if (selector.startsWith(".link-")) {
				base = "link";
			} else if (selector.startsWith(".modal-open")) {
				base = "modal";
			} else {
				base = token.name;
			}
		} else if (token.type === "pseudo-class" && token.name === "where") {
			// :where(.foo) -> .foo
			base = (tokenize(token.argument!)[0] as ClassToken).name;
		} else if (['[dir="rtl"]', ":root"].includes(token.content)) {
			// Special case for https://github.com/saadeghi/daisyui/blob/6db14181733915278621d9b2d128b0af43c52323/src/components/unstyled/modal.css#LL28C1-L28C89
			base = tokens[1]?.content.includes(".modal-open")
				? "modal"
				: // Skip prefixes
				(tokens[2] as ClassToken).name;
		}

		rules.set(base, `${(rules.get(base) ?? "") + String(node)}\n`);
	}

	const preflights: Preflight[] = getUnoCssElements(
		nodes,
		new Map<string, CSSObjectInput[]>(),
		"daisy-components",
	)
	/*Object.entries(specialRules).map(
		([key, value]) => ({
			getCSS: () => value.join("\n"),
			layer: `daisy-${key}}`,
		}),
	);*/

	if (options.base) {
		const base = await getDaisyUIObjects("base");
		preflights.unshift({
			getCSS: () => replacePrefix(process(base).css),
			layer: "daisy-base",
		});
	}

	injectThemes(
		(theme) => {
			preflights.push({
				getCSS: () => replacePrefix(process(theme as CssInJs).css),
				layer: "daisy-themes",
			});
		},
		(key) => {
			if (key === "daisyui.themes") {
				return options.themes;
			}

			if (key === "daisyui.darkTheme") {
				return options.darkTheme;
			}

			return;
		},
		allThemes,
	);

	if (options.utils) {
		const utilities = await getDaisyUIObjects("utilities");
		for (const util of Object.values(utilities)) {
			preflights.push({
				getCSS: () => replacePrefix(process(util).css),
				layer: "daisy-utilities",
			});
		}
	}

	return {
		name: "unocss-preset-daisyui-next",
		preflights,
		theme: {
			colors: {
				...Object.fromEntries(
					Object.entries(variables.colors)
						.filter(
							([color]) =>
								// Already in @unocss/preset-mini
								// https://github.com/unocss/unocss/blob/0f7efcba592e71d81fbb295332b27e6894a0b4fa/packages/preset-mini/src/_theme/colors.ts#L11-L12
								// !["transparent", "current"].includes(color) && // Removed in daisyui v5
								// Added below
								!color.startsWith("base"),
						)
						.map(([color, value]) => [camelCase(color), value]),
				),
				base: Object.fromEntries(
					Object.entries(variables.colors)
						.filter(([color]) => color.startsWith("base"))
						.map(([color, value]) => [color.replace("base-", ""), value]),
				),
			},
			// ...utilities,
		},
		rules: [...rules].map(
			([base, rule]) =>
				[
					new RegExp(`^${base}$`),
					() => replacePrefix(rule),
					{
						layer: base.startsWith("checkbox-")
							? "daisy-components-post"
							: "daisy-components",
					},
				] satisfies DynamicRule,
		),
	};
};

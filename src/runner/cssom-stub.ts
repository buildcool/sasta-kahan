// linkedom only needs a CSS parser for <style> elements, which the price checks never read.
// The real one (@acemir/cssom) is CommonJS and can't be bundled into the runner script.
export const parse = () => ({ cssRules: [] });
export default { parse };

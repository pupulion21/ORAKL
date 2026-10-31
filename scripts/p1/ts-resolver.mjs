/** ESM resolver hook for P1 local TypeScript scripts.
 *
 *  Resolves `.js` relative imports (emitted by TypeScript NodeNext convention)
 *  to `.ts` source files when running directly in Node.js.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' && specifier.endsWith('.js')) {
      const tsSpecifier = specifier.slice(0, -3) + '.ts';
      return await nextResolve(tsSpecifier, context);
    }
    throw err;
  }
}

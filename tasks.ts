import { deleteFoldersRecursive, npmInstall, buildReact, copyFiles } from '@iobroker/build-tools';

const src = `${__dirname}/src-admin/`;

function clean(): void {
    deleteFoldersRecursive(`${__dirname}/admin/custom`);
    deleteFoldersRecursive(`${src}build`);
}

function copyAllFiles(): void {
    copyFiles(['src-admin/build/customComponents.js'], 'admin/custom');
    copyFiles(['src-admin/build/customComponents.js.map'], 'admin/custom');
    // The remoteEntry (customComponents.js) lazy-loads its actual code and every shared/prebuilt
    // dependency chunk from here at runtime - without these, the component 404s in the browser.
    copyFiles(['src-admin/build/assets/*'], 'admin/custom/assets');
    // The admin reads this manifest to see which component library the build was made against,
    // and refuses to start the component if it targets an older GUI API generation.
    copyFiles(['src-admin/build/mf-manifest.json'], 'admin/custom');
}

if (process.argv.includes('--0-clean')) {
    clean();
} else if (process.argv.includes('--1-npm')) {
    npmInstall(src).catch((e: unknown) => console.error(`Cannot install npm: ${e as Error}`));
} else if (process.argv.includes('--2-build')) {
    buildReact(src, { vite: true }).catch((e: unknown) => console.error(`Cannot build: ${e as Error}`));
} else if (process.argv.includes('--3-copy')) {
    copyAllFiles();
} else {
    clean();
    npmInstall(src)
        .then(() => buildReact(src, { vite: true }))
        .then(() => copyAllFiles())
        .catch((e: unknown) => {
            console.error(e);
            process.exit(2);
        });
}

// This file only exists so Vite has a build entry point / local preview target.
// The actual production output used by ioBroker Admin is the module-federation
// bundle (customComponents.js) built from Components.tsx, not this file.
import React from 'react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (container) {
	createRoot(container).render(
		<React.StrictMode>
			<div style={{ padding: 16, fontFamily: 'sans-serif' }}>
				This is a module-federation component library with no standalone preview. Build with{' '}
				<code>npm run build</code> and load it through ioBroker Admin.
			</div>
		</React.StrictMode>,
	);
}

import { createRoot } from 'react-dom/client';
import App from './App';
import './estilos.css';
import { registrarServiceWorker } from './servicios/pwa';

// Sin <StrictMode>: sus efectos dobles en desarrollo descartarían fotos de borradores al montar y desmontar.
createRoot(document.getElementById('raiz')!).render(<App />);
registrarServiceWorker();

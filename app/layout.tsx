import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'Sentinela · copiloto de incidentes',description:'Monitoramento ativo, investigação com evidências e mitigação revisada.'};
export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="pt-BR"><body>{children}</body></html>;
}

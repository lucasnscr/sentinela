import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'Sentinela · monitoramento e operação',description:'Monitoramento ativo da aplicação e do ambiente, investigação com evidências e ajustes revisados.'};
export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="pt-BR"><body>{children}</body></html>;
}

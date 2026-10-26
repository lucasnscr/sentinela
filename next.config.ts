import type { NextConfig } from 'next';
const config:NextConfig={
  output:'standalone',
  poweredByHeader:false,
  turbopack:{root:process.cwd()},
  outputFileTracingRoot:process.cwd(),
  outputFileTracingIncludes:{'/*':['./lib/schema.sql']},
  devIndicators:false,
};
export default config;

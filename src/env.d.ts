/// <reference types="vite/client" />
declare const __APP_VERSION__: string;
declare module 'monaco-editor/languages/definitions/*' {
  export const language: import('monaco-editor').languages.IMonarchLanguage;
}
declare module 'monaco-editor/editor/contrib/*';

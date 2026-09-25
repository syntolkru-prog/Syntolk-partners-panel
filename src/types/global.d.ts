declare namespace NodeJs {
    interface ProcessEnv {
        JWT_SECRET: string;
        DATABASE_URL: string;
        RESEND_API_KEY: string;
        NEXT_PUBLIC_APP_URL: string;
    }
}

declare var process: {
    env: NodeJs.ProcessEnv;
};

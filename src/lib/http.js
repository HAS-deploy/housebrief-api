const DEFAULT_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
};

export const ok = (body, status = 200) => ({
    statusCode: status, headers: DEFAULT_HEADERS, body: JSON.stringify(body),
});

export const err = (message, status = 400) => ({
    statusCode: status, headers: DEFAULT_HEADERS, body: JSON.stringify({ error: message }),
});

export const json = (event) => {
    try { return event.body ? JSON.parse(event.body) : {}; }
    catch { return null; }
};

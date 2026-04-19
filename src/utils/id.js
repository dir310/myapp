/**
 * Genera un código de viaje corto y aleatorio (ej: ZIPPY-A7B2)
 */
export function generateRideCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Evitamos I, O, 0, 1 para legibilidad
    let result = '';
    for (let i = 0; i < 4; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `ZIPPY-${result}`;
}

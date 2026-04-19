/**
 * Genera un código de viaje numérico de 6 dígitos (ej: 482910)
 */
export function generateRideCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

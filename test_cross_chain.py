import requests
import json

# Reemplaza esto con un Hash de transacción de origen REAL donde se haya usado un bridge (ej. Stargate, Hop, Across, etc.)
# Debe ser un hash de origen válido que ya conozcas que cruzó de red.
TEST_TX_HASH = "0x7b1a4796e6571f3c7a3c5c6e95473d76ccd547641b2a72b12da6c33d438d8c36" 

# Endpoint público de seguimiento de Li.Fi
URL = "https://li.quest/v1/status"

params = {
    "txHash": TEST_TX_HASH
}

print(f"--> Consultando el estado cross-chain en Li.Fi para el hash: {TEST_TX_HASH}")

try:
    response = requests.get(URL, params=params, timeout=12)
    print(f"--> Status Code HTTP: {response.status_code}")
    
    if response.status_code == 200:
        data = response.json()
        print("\n✅ ¡ÉXITO! RESPUESTA OBTENIDA:")
        print(json.dumps(data, indent=2))
        
        # Extraer información clave si está disponible
        status = data.get("status", "Desconocido")
        receiving = data.get("receiving", {})
        receiving_tx = receiving.get("txHash", "Aún no disponible / No aplica")
        
        print(f"\n--- RESUMEN DE RASTREO ---")
        print(f" Estado del Puente: {status}")
        print(f" Hash en Destino: {receiving_tx}")
        
    else:
        print(f"\n❌ Error HTTP {response.status_code}: {response.text}")

except Exception as e:
    print(f"\n❌ Excepción de red: {e}")
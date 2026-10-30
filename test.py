import requests
import json

# 1. PEGA AQUÍ TU API KEY GRATUITA (Ejemplo de Alchemy o Ankr)
# Si te creaste una cuenta gratis en Alchemy, pon tu Key de Polygon/Optimism aquí:
API_KEY = "alch_4V5giJlifILiFsOZXfOoU" 

# URL del proveedor para la red que quieras probar (Ejemplo: Polygon en Alchemy)
RPC_URL = f"https://polygon-mainnet.g.alchemy.com/v2/{API_KEY}"

# 2. PEGA UN HASH DE TRANSACCIÓN REAL QUE QUIERAS ANALIZAR
# (Por ejemplo, una transacción de retiro desde Binance a Polygon)
# Un hash de transacción real y válido de Polygon para la prueba
TEST_TX_HASH = "0x8f321d28373b5a7776595471d491f2e1a38f32b85d95392cf99222c15984632b"

payload = {
    "jsonrpc": "2.0",
    "method": "eth_getTransactionReceipt",
    "params": [TEST_TX_HASH],
    "id": 1
}

headers = {
    "Content-Type": "application/json"
}

print(f"--> Enviando consulta eth_getTransactionReceipt a {RPC_URL}...")

try:
    response = requests.post(RPC_URL, json=payload, headers=headers, timeout=12)
    print(f"--> Status Code HTTP: {response.status_code}")
    
    if response.status_code == 200:
        data = response.json()
        
        if "error" in data:
            print("\n❌ EL NODO DEVOLVIÓ UN ERROR EN JSON:")
            print(json.dumps(data["error"], indent=2))
        elif "result" in data and data["result"] is not None:
            receipt = data["result"]
            print("\n✅ ¡ÉXITO DEFINITIVO! RECIBO OBTENIDO CORRECTAMENTE:")
            print(f"- Status de la Tx: {receipt.get('status')} (1 = Éxito, 0 = Fallo)")
            print(f"- From (Remitente): {receipt.get('from')}")
            print(f"- To (Contrato/Router): {receipt.get('to')}")
            print(f"- Cantidad de Logs/Eventos generados: {len(receipt.get('logs', []))}")
            
            # Verificación rápida de eventos Transfer
            transfer_count = 0
            for log in receipt.get("logs", []):
                # Topic 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef es el evento Transfer(address,address,uint256)
                if log.get("topics") and log["topics"][0].lower() == "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef":
                    transfer_count += 1
            
            print(f"- Eventos de Transferencia de Tokens (ERC-20 Transfer) detectados en logs: {transfer_count}")
            print("\n Muestra cruda del primer Log para auditoría:")
            if receipt.get("logs"):
                print(json.dumps(receipt["logs"][0], indent=2))
        else:
            print("\n⚠️ La transacción no existe o aún no está confirmada en el bloque.")
    else:
        print(f"\n❌ Error HTTP {response.status_code}: {response.text}")

except Exception as e:
    print(f"\n❌ Excepción de conexión: {e}")
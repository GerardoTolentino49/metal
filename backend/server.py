from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import os
from datetime import datetime
import uuid

app = Flask(__name__)
CORS(app)  # Habilitar CORS para todas las rutas

# Asegurarse de que el directorio backend existe
if not os.path.exists('backend'):
    os.makedirs('backend')

# Ruta para obtener tickets
@app.route('/obtener_tickets', methods=['GET'])
def obtener_tickets():
    try:
        if os.path.exists('backend/tickets.json'):
            with open('backend/tickets.json', 'r') as f:
                tickets = json.load(f)
        else:
            tickets = []
        return jsonify({'tickets': tickets})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Ruta para guardar un nuevo ticket
@app.route('/guardar_ticket', methods=['POST'])
def guardar_ticket():
    try:
        ticket = request.json
        ticket['id'] = str(uuid.uuid4())
        ticket['fecha'] = datetime.now().isoformat()
        ticket['estado'] = 'solicitudes'
        
        tickets = []
        if os.path.exists('backend/tickets.json'):
            with open('backend/tickets.json', 'r') as f:
                tickets = json.load(f)
        
        tickets.append(ticket)
        
        with open('backend/tickets.json', 'w') as f:
            json.dump(tickets, f, indent=2)
        
        return jsonify({'success': True, 'id': ticket['id']})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Ruta para actualizar el estado de un ticket
@app.route('/actualizar_estado', methods=['POST'])
def actualizar_estado():
    try:
        data = request.json
        ticket_id = data.get('id')
        nuevo_estado = data.get('estado')
        
        if not os.path.exists('backend/tickets.json'):
            return jsonify({'error': 'No hay tickets guardados'}), 404
        
        with open('backend/tickets.json', 'r') as f:
            tickets = json.load(f)
        
        ticket_encontrado = False
        for ticket in tickets:
            if ticket['id'] == ticket_id:
                ticket['estado'] = nuevo_estado
                ticket_encontrado = True
                break
        
        if not ticket_encontrado:
            return jsonify({'error': 'Ticket no encontrado'}), 404
        
        with open('backend/tickets.json', 'w') as f:
            json.dump(tickets, f, indent=2)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("Servidor de datos iniciado en http://127.0.0.1:5000")
    print("Ahora puedes abrir los archivos HTML directamente desde el explorador")
    app.run(host='127.0.0.1', port=5000, debug=True) 
<%@ WebHandler Language="C#" Class="UpdateUrgencyHandler" %>
using System;
using System.Web;
using System.Data.SqlClient;
using System.IO;
using System.Web.Script.Serialization;

public class UpdateUrgencyHandler : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        context.Response.ContentType = "application/json";
        
        try
        {
            // Leer el cuerpo de la solicitud
            string json;
            using (var reader = new StreamReader(context.Request.InputStream))
            {
                json = reader.ReadToEnd();
            }

            // Deserializar el JSON
            var serializer = new JavaScriptSerializer();
            var data = serializer.Deserialize<dynamic>(json);
            
            string ticketId = data["ticketId"];
            string urgency = data["urgency"];

            // Actualizar en la base de datos
            string connStr = "Server=localhost;Database=TICKETS;User Id=sa;Password=YourStrong@Passw0rd;";
            using (SqlConnection conn = new SqlConnection(connStr))
            {
                conn.Open();
                string sql = "UPDATE Tickets SET urgency = @urgency WHERE id = @id";
                using (SqlCommand cmd = new SqlCommand(sql, conn))
                {
                    cmd.Parameters.AddWithValue("@urgency", urgency);
                    cmd.Parameters.AddWithValue("@id", ticketId);
                    cmd.ExecuteNonQuery();
                }
            }

            // Enviar respuesta exitosa
            context.Response.Write(serializer.Serialize(new { success = true }));
        }
        catch (Exception ex)
        {
            context.Response.StatusCode = 500;
            context.Response.Write(serializer.Serialize(new { success = false, error = ex.Message }));
        }
    }

    public bool IsReusable { get { return false; } }
} 
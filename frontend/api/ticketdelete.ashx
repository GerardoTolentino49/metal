<%@ WebHandler Language="C#" Class="TicketDeleteHandler" %>
using System;
using System.Web;
using System.Data.SqlClient;

public class TicketDeleteHandler : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        context.Response.ContentType = "application/json";
        string id = context.Request.PathInfo.Replace("/", "");
        if (string.IsNullOrEmpty(id))
        {
            context.Response.StatusCode = 400;
            context.Response.Write("{\"error\":\"ID requerido\"}");
            return;
        }

        string connStr = "Server=localhost;Database=TICKETS;User Id=sa;Password=YourStrong@Passw0rd;";
        using (SqlConnection conn = new SqlConnection(connStr))
        {
            conn.Open();
            string sql = "DELETE FROM Tickets WHERE id = @id";
            using (SqlCommand cmd = new SqlCommand(sql, conn))
            {
                cmd.Parameters.AddWithValue("@id", id);
                int rows = cmd.ExecuteNonQuery();
                if (rows > 0)
                {
                    context.Response.Write("{\"success\":true}");
                }
                else
                {
                    context.Response.StatusCode = 404;
                    context.Response.Write("{\"error\":\"No encontrado\"}");
                }
            }
        }
    }

    public bool IsReusable { get { return false; } }
} 
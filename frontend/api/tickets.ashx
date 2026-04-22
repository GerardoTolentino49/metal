<%@ WebHandler Language="C#" Class="TicketsHandler" %>
using System;
using System.Web;
using System.Data.SqlClient;
using System.Text;
using System.Web.Script.Serialization;
using System.Collections.Generic;

public class TicketsHandler : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        context.Response.ContentType = "application/json";
        var tickets = new List<object>();

        string connStr = "Server=localhost;Database=TICKETS;User Id=sa;Password=YourStrong@Passw0rd;";
        using (SqlConnection conn = new SqlConnection(connStr))
        {
            conn.Open();
            string sql = "SELECT id, name, department, issue, anydesk, timestamp, urgency FROM Tickets";
            using (SqlCommand cmd = new SqlCommand(sql, conn))
            using (SqlDataReader reader = cmd.ExecuteReader())
            {
                while (reader.Read())
                {
                    tickets.Add(new {
                        id = reader["id"],
                        name = reader["name"],
                        department = reader["department"],
                        issue = reader["issue"],
                        anydesk = reader["anydesk"],
                        timestamp = reader["timestamp"],
                        urgency = reader["urgency"]
                    });
                }
            }
        }
        var serializer = new JavaScriptSerializer();
        context.Response.Write(serializer.Serialize(tickets));
    }

    public bool IsReusable { get { return false; } }
} 